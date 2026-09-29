'use strict';
const fs = require('fs');
const path = require('path');
const { run, ffmpeg, ffprobe, py } = require('./util');
const config = require('./config');
const { writeJson, readJson } = require('./util');

const TEXT_KINDS = ['headline', 'subline', 'cta', 'url', 'caption'];
const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2;
const rectOf = (b) => (b.bx ? { x: b.bx[0], y: b.bx[1], w: b.bx[2], h: b.bx[3] } : { x: b.x, y: b.y, w: b.w, h: b.h });

function analyzeLayout(reports) {
  const outside = []; const small = []; const collide = [];
  for (const r of reports) {
    const { L, R, B } = r.safe; const minPx = 0.026 * Math.min(r.W, r.H);
    const vis = r.boxes.filter((b) => b.alpha > 0.6);
    for (const b of vis) {
      const rc = rectOf(b);
      if (TEXT_KINDS.includes(b.kind) || b.kind === 'logo') {
        if (rc.x < L - 2 || rc.x + rc.w > R + 2 || rc.y < -2 || rc.y + rc.h > B + 2 || rc.x < 0 || rc.x + rc.w > r.W) outside.push({ t: r.t, id: b.id, kind: b.kind, rect: rc, safe: { L, R, B } });
      }
      if (TEXT_KINDS.includes(b.kind) && b.fontPx < minPx) small.push({ t: r.t, id: b.id, fontPx: Math.round(b.fontPx), minPx: Math.round(minPx) });
    }
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i]; const b = vis[j];
      if (a.kind === 'cta' && b.kind === 'url' || a.kind === 'url' && b.kind === 'cta') continue;
      if (overlap(rectOf(a), rectOf(b))) collide.push({ t: r.t, a: a.id, b: b.id });
    }
  }
  return { outside, small, collide };
}

const st = (ok, extra = {}) => ({ status: ok ? 'pass' : 'fail', ...extra });

async function probeChecks(dir, timeline, files) {
  const out = {};
  const want = { mp4: { v: 'h264', a: 'aac' }, webm: { v: 'vp9', a: 'opus' } };
  for (const kind of ['mp4', 'webm']) {
    const rel = files[kind]; const abs = rel && path.join(dir, rel);
    if (!abs || !fs.existsSync(abs) || fs.statSync(abs).size < 1000) { out[`ffprobe_${kind}`] = { status: 'fail', detail: 'file missing or empty' }; continue; }
    try {
      const j = await ffprobe(abs); const v = j.streams.find((s) => s.codec_type === 'video'); const a = j.streams.find((s) => s.codec_type === 'audio');
      const [n, d] = (v?.avg_frame_rate || '0/1').split('/').map(Number); const fps = d ? n / d : 0; const dur = Number(j.format.duration);
      const problems = [];
      if (!v) problems.push('no video stream'); else {
        if (v.codec_name !== want[kind].v) problems.push(`video codec ${v.codec_name} != ${want[kind].v}`);
        if (v.width !== timeline.width || v.height !== timeline.height) problems.push(`resolution ${v.width}x${v.height} != ${timeline.width}x${timeline.height}`);
        if (Math.abs(fps - timeline.fps) > 0.5) problems.push(`fps ${fps.toFixed(2)} != ${timeline.fps}`);
      }
      if (!a) problems.push('no audio stream'); else if (a.codec_name !== want[kind].a) problems.push(`audio codec ${a.codec_name} != ${want[kind].a}`);
      if (Math.abs(dur - timeline.duration) > 0.3) problems.push(`duration ${dur.toFixed(2)}s vs timeline ${timeline.duration}s`);
      out[`ffprobe_${kind}`] = { ...st(problems.length === 0), detail: problems.join('; ') || 'ok', measured: { duration: +dur.toFixed(3), fps: +fps.toFixed(2), width: v?.width, height: v?.height, vcodec: v?.codec_name, acodec: a?.codec_name, sizeBytes: Number(j.format.size) } };
      try { const r = await run(config.findFfmpeg(), ['-v', 'error', '-i', abs, '-f', 'null', '-']); out[`decode_${kind}`] = st(r.err.trim() === '', { detail: r.err.trim().slice(0, 300) || 'full decode without errors' }); } catch (e) { out[`decode_${kind}`] = { status: 'fail', detail: e.message.slice(0, 300) }; }
    } catch (e) { out[`ffprobe_${kind}`] = { status: 'fail', detail: e.message.slice(0, 300) }; }
  }
  return out;
}

async function runQa(ctx) {
  const { dir, timeline, files, layoutReports, page, problems, voiceValidation, framesDir, mock, project, attempts } = ctx;
  const checks = { ...(await probeChecks(dir, timeline, files)) };

  const js = [...(page.errors || []).filter((e) => !e.startsWith('info:')), ...problems];
  checks.js_errors = js.length ? { status: 'fail', detail: js.slice(0, 8).join(' | ') } : { status: 'pass', detail: 'no JS errors, no failed requests' };
  checks.missing_assets = page.missing.length ? { status: 'fail', detail: 'missing: ' + page.missing.join(', ') } : { status: 'pass', detail: 'all timeline assets loaded' };

  // black / blank frames + abrupt scene ends (from rendered frames)
  if (fs.existsSync(framesDir) && fs.readdirSync(framesDir).length) {
    const fp = (t) => path.join(framesDir, `f${String(Math.min(Math.round(t * timeline.fps), Math.round(timeline.duration * timeline.fps) - 1) + 1).padStart(5, '0')}.jpg`);
    const sample = []; for (let t = 0; t < timeline.duration; t += 0.5) sample.push({ file: fp(t), label: t.toFixed(1) });
    const pairs = timeline.scenes.slice(1).map((s) => ({ a: fp(s.start - 1 / timeline.fps), b: fp(s.start), label: s.id }));
    const jobF = path.join(dir, 'analysis', 'qa-frames-job.json'); const outF = path.join(dir, 'analysis', 'qa-frames.json');
    writeJson(jobF, { frames: sample, pairs }); await py('qa_tools.py', ['frames', jobF, outF]);
    const r = readJson(outF); fs.rmSync(jobF, { force: true });
    const bad = r.frames.filter((f) => f.mean < 8 || f.std < 2);
    checks.black_or_blank_frames = bad.length ? { status: 'fail', detail: `${bad.length} suspicious frames at t=${bad.slice(0, 6).map((b) => b.label).join(', ')}s`, frames: bad } : { status: 'pass', detail: `${r.frames.length} sampled frames have normal brightness/contrast` };
    const abrupt = r.pairs.filter((p) => p.diff > 0.08);
    checks.abrupt_scene_ends = abrupt.length ? { status: 'fail', detail: 'visual jump at ' + abrupt.map((a) => `${a.label} (${a.diff})`).join(', ') } : { status: 'pass', detail: 'no visual jumps at scene boundaries', maxDiff: Math.max(0, ...r.pairs.map((p) => p.diff)) };
  } else { checks.black_or_blank_frames = { status: 'not_tested', detail: 'frames were deleted; re-render to test' }; checks.abrupt_scene_ends = { status: 'not_tested', detail: 'frames were deleted' }; }

  const lay = analyzeLayout(layoutReports);
  checks.text_inside_safe_area = lay.outside.length ? { status: 'fail', detail: `${lay.outside.length} text boxes outside safe area, e.g. ${lay.outside[0].id} @${lay.outside[0].t}s` } : { status: 'pass', detail: `${layoutReports.length} layout samples checked` };
  checks.text_min_size = lay.small.length ? { status: 'fail', detail: `${lay.small.length} text layers below minimum (e.g. ${lay.small[0].id}: ${lay.small[0].fontPx}px < ${lay.small[0].minPx}px)` } : { status: 'pass', detail: 'all text >= 2.6% of the short side (readable on phone)' };
  checks.text_collisions = lay.collide.length ? { status: 'fail', detail: `${lay.collide.length} overlaps, e.g. ${lay.collide[0].a} x ${lay.collide[0].b} @${lay.collide[0].t}s` } : { status: 'pass', detail: 'no overlapping text/UI/logo/caption boxes' };

  // CTA in final scene
  const last = timeline.scenes[timeline.scenes.length - 1]; const ctaLayer = last.layers.find((l) => l.kind === 'cta');
  const finalRep = layoutReports.find((r) => Math.abs(r.t - (timeline.duration - 0.05)) < 0.01);
  const ctaBox = finalRep && finalRep.boxes.find((b) => b.kind === 'cta');
  checks.cta_in_final_scene = ctaLayer && ctaLayer.text && ctaBox && ctaBox.alpha > 0.9 ? { status: 'pass', detail: `"${ctaLayer.text}" visible at the end` } : { status: 'fail', detail: 'CTA not visible in the final scene' };

  // voice
  const vscenes = Object.values(voiceValidation?.scenes || {});
  if (!vscenes.length) checks.voice_whisper_check = { status: 'not_tested', detail: 'no voice-over' };
  else if (voiceValidation.mock) checks.voice_whisper_check = { status: 'not_tested', detail: 'mock project: Whisper was not called; transcript equals the target text by construction' };
  else { const failed = vscenes.filter((v) => !v.pass); checks.voice_whisper_check = failed.length ? { status: 'warn', detail: `${failed.length}/${vscenes.length} scenes differ from the script: ` + failed.map((f) => `${f.sceneId} (${Math.round(f.ratio * 100)}%${f.truncated ? ', cut off' : ''})`).join(', ') } : { status: 'pass', detail: `${vscenes.length} scenes match the script (Whisper is a content check, not a pronunciation test)` }; }
  const cut = timeline.audio.voice.filter((v) => { const sc = timeline.scenes.find((s) => s.id === v.sceneId); return v.start + v.duration > sc.start + sc.duration - 0.15; });
  checks.voice_fits_scenes = cut.length ? { status: 'fail', detail: 'voice runs past scene end in ' + cut.map((c) => c.sceneId).join(', ') } : { status: 'pass', detail: 'each voice line finishes before its scene ends' };

  // audio levels
  try {
    const job = { mix: path.join(dir, 'output', 'mix.wav'), voice: path.join(dir, 'output', 'voice.wav'), music: timeline.audio.music ? path.join(dir, 'output', 'music.wav') : null };
    const jf = path.join(dir, 'analysis', 'qa-audio-job.json'); const of = path.join(dir, 'analysis', 'qa-audio.json'); writeJson(jf, job); await py('qa_tools.py', ['audio', jf, of]);
    const a = readJson(of); fs.rmSync(jf, { force: true });
    checks.audio_clipping = a.clippedSamples === 0 && a.mixPeakDb <= -0.4 ? { status: 'pass', detail: `peak ${a.mixPeakDb} dBFS, 0 clipped samples`, measured: a } : { status: 'fail', detail: `peak ${a.mixPeakDb} dBFS, ${a.clippedSamples} clipped samples`, measured: a };
    if (a.voiceToMusicDb == null) checks.voice_music_balance = { status: 'skipped', detail: timeline.audio.music ? 'no voice' : 'music is off' };
    else checks.voice_music_balance = a.voiceToMusicDb >= 8 ? { status: 'pass', detail: `voice is ${a.voiceToMusicDb} dB above music while speaking`, measured: a } : { status: 'fail', detail: `voice only ${a.voiceToMusicDb} dB above music (need >= 8)`, measured: a };
  } catch (e) { checks.audio_clipping = { status: 'fail', detail: 'audio analysis failed: ' + e.message.slice(0, 200) }; }

  if (project.presetId && ctx.concept.requiresProductUI && !timeline.scenes.some((s) => s.layers.some((l) => l.kind === 'ui'))) checks.product_ui_present = { status: 'warn', detail: 'preset needs real UI screenshots; none used. Output is a concept plate only.' };
  if (timeline.style.textScale < 1) checks.auto_adjustments = { status: 'warn', detail: `text scale reduced to ${timeline.style.textScale} by automatic repair` };

  const failed = Object.entries(checks).filter(([, c]) => c.status === 'fail').map(([k]) => k);
  return {
    generatedAt: new Date().toISOString(), project: project.id, mode: ctx.mode, mock: !!mock,
    overall: failed.length ? 'fail' : 'pass', failedChecks: failed,
    summary: { pass: Object.values(checks).filter((c) => c.status === 'pass').length, fail: failed.length, warn: Object.values(checks).filter((c) => c.status === 'warn').length, notTested: Object.values(checks).filter((c) => c.status === 'not_tested' || c.status === 'skipped').length },
    renderAttempts: attempts, timeline: { duration: timeline.duration, target: timeline.targetDuration, fps: timeline.fps, width: timeline.width, height: timeline.height, scenes: timeline.scenes.length, fx: page.fx },
    checks, layoutFindings: lay,
    limitations: [
      'Automated QA checks technical correctness only; it cannot judge visual taste, brand fit or whether the story persuades. Watch the video before publishing.',
      'Black/blank detection samples one frame every 0.5 s using brightness and contrast, so very short glitches can be missed.',
      'Text checks use the engine\'s own layout boxes; text inside supplied screenshots is not analysed and may be small on phones.',
      'Whisper compares words with the script; it does not prove pronunciation, tone or that the voice is pleasant. Listen to the voice-over.',
      'Voice/music balance is measured on stems as RMS while speech is active; perceived loudness may differ.',
      'Claim linting is keyword-based and cannot catch every unapproved statement; review the script.',
      mock ? 'MOCK RUN: images, music and voice are local synthetic test assets; no Fal services were called.' : null,
      ctx.placeholders ? 'DRAFT: assets that were not already generated are local placeholders (no paid calls in Draft mode). Run Final for real assets.' : null,
    ].filter(Boolean),
  };
}

// Which failures the pipeline may repair automatically by re-rendering.
function planRepair(report, timeline) {
  const f = new Set(report.failedChecks); const fix = {}; const notes = [];
  if (['text_inside_safe_area', 'text_min_size', 'text_collisions'].some((k) => f.has(k))) {
    if (f.has('text_min_size') && !f.has('text_inside_safe_area') && !f.has('text_collisions')) notes.push('text too small cannot be fixed by shrinking; manual edit needed');
    else if ((timeline.style.textScale || 1) > 0.72) { fix.textScale = +((timeline.style.textScale || 1) * 0.9).toFixed(3); notes.push(`text scale -> ${fix.textScale}`); }
  }
  if (f.has('voice_music_balance')) { fix.duckDb = Math.min(30, (timeline.audio.duckDb || 14) + 5); notes.push(`duck ${fix.duckDb} dB`); }
  if (f.has('audio_clipping') && !fix.duckDb) { fix.duckDb = Math.min(30, (timeline.audio.duckDb || 14) + 3); notes.push('reduce peaks via stronger ducking'); }
  if (['ffprobe_mp4', 'ffprobe_webm', 'decode_mp4', 'decode_webm'].some((k) => f.has(k))) notes.push('re-encode');
  return { fix, notes, repairable: Object.keys(fix).length > 0 || notes.includes('re-encode') };
}

module.exports = { runQa, planRepair, analyzeLayout };
