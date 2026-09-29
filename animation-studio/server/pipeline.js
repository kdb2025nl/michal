'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./store');
const pricing = require('./pricing');
const { Providers, hashes, SpendLimitError } = require('./providers');
const { validateConcept, validateFacts } = require('./schemas');
const { lintClaims } = require('./concept');
const { buildTimeline } = require('./timeline');
const { compareTranscript } = require('./voicecheck');
const render = require('./render');
const { runQa, planRepair } = require('./qa');
const { readJson, writeJson, sha, py, ffmpeg, audioDuration, slug, redact, roundTo } = require('./util');

const MODES = { draft: { short: 480, fps: 30, jpegQ: 0.82, name: 'draft', allowPaid: false }, final: { short: 1080, fps: 30, jpegQ: 0.95, name: 'final', allowPaid: true } };
const modeFor = (p) => { const m = { ...MODES[p.mode || 'final'] }; if (m.name === 'final') m.short = Number(p.form?.resolution) || 1080; return m; };

const conceptPath = (dir) => path.join(dir, 'concept.json');
const loadConcept = (dir) => readJson(conceptPath(dir));
const rel = (dir, abs) => path.relative(dir, abs).split(path.sep).join('/');

// Normalise planned durations so scenes sum to the target duration (rounded to 0.1 s, remainder to last scene).
function normaliseDurations(concept) {
  const total = concept.scenes.reduce((n, s) => n + s.plannedDuration, 0) || 1;
  let acc = 0;
  concept.scenes.forEach((s, i) => { if (i < concept.scenes.length - 1) { s.plannedDuration = roundTo(Math.max(2, (s.plannedDuration / total) * concept.durationSec), 1); acc += s.plannedDuration; } });
  concept.scenes[concept.scenes.length - 1].plannedDuration = roundTo(Math.max(2, concept.durationSec - acc), 1);
  return concept;
}

function validateStoryboard(concept) {
  const v = validateConcept(concept); const errors = [...v.errors];
  if (v.ok) {
    const sum = concept.scenes.reduce((n, s) => n + s.plannedDuration, 0);
    if (Math.abs(sum - concept.durationSec) > 0.55) errors.push(`scene durations sum to ${sum.toFixed(1)}s but target is ${concept.durationSec}s`);
    const bgIds = new Set(concept.assets.images.map((i) => i.id));
    for (const s of concept.scenes) if (!bgIds.has(s.bg)) errors.push(`scene ${s.id}: unknown background ${s.bg}`);
    for (const s of concept.scenes) if (s.type === 'product' && !s.screenshot) errors.push(`scene ${s.id}: product scenes need a screenshot (no fabricated UI is generated)`);
    const ids = new Set(); for (const s of concept.scenes) { if (ids.has(s.id)) errors.push('duplicate scene id ' + s.id); ids.add(s.id); }
    if (concept.scenes[concept.scenes.length - 1].type !== 'cta') errors.push('the last scene must be a CTA scene');
  }
  const claims = v.ok ? lintClaims(concept) : [];
  return { ok: errors.length === 0 && claims.length === 0, errors, claims };
}

function haveMap(p, concept) {
  const dir = store.dirOf(p.id); const prov = new Providers({ dir, settings: p.settings, ledger: p.ledger, mock: p.mock, allowPaid: true });
  const have = {}; const size = pricing.imageSizeFor(concept.format);
  for (const im of concept.assets.images) if (prov.isCached(`image:${im.id}`, hashes.image(im.prompt, size, p.settings.imageQuality, p.mock))) have[`image:${im.id}`] = true;
  const ms = Math.max(3000, Math.round(pricing.musicSeconds(concept.durationSec) * 1000));
  if (prov.isCached('music', hashes.music(concept.musicPrompt, ms, p.mock))) have.music = true;
  const att = p.outputs.ttsAttempt || {};
  for (const s of concept.scenes) if (s.voiceover && prov.isCached(`tts:${s.id}`, hashes.tts(pricing.applyPronunciations(s.voiceover, concept.voice.pronunciations), concept.voice.voice, concept.language, p.mock, att[s.id] || 0))) have[`tts:${s.id}`] = true;
  return have;
}
const estimateFor = (p, concept) => pricing.estimate(concept, p.settings, haveMap(p, concept));

// ---- preview timeline for the storyboard editor (no paid assets, estimated durations) ----
function previewTimeline(p) {
  const dir = store.dirOf(p.id); const concept = loadConcept(dir);
  const ui = {}; for (const s of concept.scenes) if (s.screenshot) ui[s.screenshot] = `uploads/${s.screenshot}`;
  const assets = { bg: p.outputs.assetsMap?.bg || {}, ui: { ...ui, ...(p.outputs.assetsMap?.ui || {}) }, logo: p.outputs.assetsMap?.logo || (concept.brand.logo ? `uploads/${concept.brand.logo}` : null), fonts: p.outputs.assetsMap?.fonts || [] };
  return buildTimeline(concept, { mode: { short: 540, fps: 30 }, assets, seed: p.outputs.seed || 1234 });
}

class Runner {
  constructor(origin) { this.origin = origin; this.queue = []; this.active = null; this.cancelled = new Set(); }

  enqueue(id, opts = {}) {
    const p = store.load(id);
    if (this.active === id || this.queue.some((q) => q.id === id)) throw Object.assign(new Error('project is already running'), { status: 409 });
    p.status = 'queued'; store.log(p, `queued (${opts.mode || p.mode})`); store.save(p);
    this.queue.push({ id, opts }); setImmediate(() => this.pump());
  }
  async pump() {
    if (this.active || !this.queue.length) return;
    const { id, opts } = this.queue.shift(); this.active = id;
    try { await this.run(id, opts); } catch (e) { console.error('pipeline crash', redact(e.stack || e.message)); } finally { this.active = null; setImmediate(() => this.pump()); }
  }
  // On server start: anything left "running" was interrupted.
  recover() {
    for (const s of store.list()) {
      const p = store.load(s.id);
      if (['running', 'queued'].includes(p.status)) {
        for (const st of Object.values(p.stages)) if (st.status === 'running') { st.status = 'failed'; st.error = 'Interrupted by server restart. Press retry - paid results already saved are reused.'; }
        p.status = 'failed'; store.log(p, 'recovered after restart'); store.save(p);
      }
    }
  }

  async run(id, opts) {
    let p = store.load(id); const dir = store.dirOf(id);
    if (opts.mode) p.mode = opts.mode; if (opts.mock !== undefined) p.mock = !!opts.mock;
    if (opts.retryStage) { const from = store.STAGES.indexOf(opts.retryStage); store.STAGES.forEach((s, i) => { if (i >= from) { p.stages[s].status = 'pending'; delete p.stages[s].error; } }); }
    p.status = 'running'; delete p.error; store.save(p);
    const mode = modeFor(p);
    let guard = 0;
    while (guard++ < 12) {
      let repairNeeded = false;
      for (const name of store.STAGES) {
        p = store.load(id); const st = p.stages[name];
        const concept = loadConcept(dir); const sig = this.sigFor(name, p, concept, mode);
        if (st.status === 'done' && st.sig === sig) continue;
        st.status = 'running'; st.startedAt = new Date().toISOString(); st.attempts = (st.attempts || 0) + 1; delete st.error; delete st.progress; store.log(p, `stage ${name} started`); store.save(p);
        try {
          const ctx = this.makeCtx(id, mode);
          const result = await this[`stage_${name}`](ctx, concept);
          p = store.load(id); const st2 = p.stages[name];
          st2.status = result?.skipped ? 'skipped' : 'done'; st2.sig = sig; st2.finishedAt = new Date().toISOString(); st2.note = result?.note || ''; delete st2.progress;
          store.log(p, `stage ${name} ${st2.status}${result?.note ? ': ' + result.note : ''}`); store.save(p);
          if (result?.repair) { repairNeeded = true; break; }
        } catch (e) {
          p = store.load(id); p.stages[name].status = 'failed'; p.stages[name].error = this.friendly(e); p.status = 'failed'; p.error = { stage: name, message: p.stages[name].error };
          store.log(p, `stage ${name} FAILED: ${e.message}`); store.save(p); return;
        }
      }
      if (!repairNeeded) break;
    }
    p = store.load(id);
    const qa = readJson(path.join(dir, 'qa-report.json'), null);
    p.status = qa && qa.overall === 'pass' ? 'done' : 'done_with_issues';
    store.log(p, `finished: ${p.status}`); store.save(p);
  }

  friendly(e) {
    const m = redact(e.message || String(e));
    if (e.code === 'SPEND_LIMIT') return m;
    if (/FAL_KEY/.test(m)) return m;
    if (/Python 3 not found/.test(m)) return m;
    if (/No Chrome/.test(m)) return m;
    if (e.code === 'ENOENT' && /ffmpeg|ffprobe/.test(m)) return 'FFmpeg not found. Run "npm install" again (ffmpeg-static) or set FFMPEG_PATH.';
    return m.slice(0, 900);
  }

  makeCtx(id, mode) {
    const dir = store.dirOf(id); const p = store.load(id);
    const ctx = { id, dir, mode, origin: this.origin };
    ctx.providers = new Providers({
      dir, settings: p.settings, ledger: p.ledger, mock: p.mock, allowPaid: mode.allowPaid, consentFiles: p.consent.sendFiles,
      log: (m) => { const q = store.load(id); store.log(q, m); store.save(q); },
      onSave: () => { const q = store.load(id); q.ledger = ctx.providers.ctx.ledger; store.save(q); },
    });
    ctx.providers.ctx.ledger = p.ledger; // shared mutable, persisted via onSave
    ctx.update = (fn) => { const q = store.load(id); fn(q); store.save(q); };
    ctx.progress = (stage, frac, note) => ctx.update((q) => { q.stages[stage].progress = Math.round(frac * 100); if (note) q.stages[stage].note = note; });
    return ctx;
  }

  sigFor(name, p, concept, mode) {
    const up = p.uploads; const mock = p.mock; const paid = mode.allowPaid;
    const repair = p.outputs.repair || {}; const att = p.outputs.ttsAttempt || {};
    const base = { storyboard: sha({ concept }) };
    base.images = sha({ img: concept.assets.images, used: concept.scenes.map((s) => [s.bg, s.screenshot]), f: concept.format, q: p.settings.imageQuality, up: [up.screenshots, up.logo, up.fonts], mock, paid, sb: base.storyboard });
    base.music = sha({ a: concept.musicPrompt, l: concept.musicLevel, d: concept.durationSec, mock, paid });
    base.voice = sha({ s: concept.scenes.map((s) => [s.id, s.voiceover]), v: concept.voice, l: concept.language, mock, paid, att });
    base.whisper = sha({ v: base.voice, l: concept.language, mock, paid });
    base.analysis = sha({ m: base.music });
    base.animation = sha({ all: [base.storyboard, base.images, base.music, base.voice, base.whisper, base.analysis], mode, repair, seed: p.outputs.seed });
    base.render = sha({ a: base.animation });
    base.qa = sha({ r: base.render });
    return base[name];
  }

  // ---------------- stages ----------------
  async stage_storyboard(ctx, concept) {
    const check = validateStoryboard(concept);
    if (!check.ok) throw new Error('Storyboard invalid: ' + [...check.errors, ...check.claims.map((c) => c.message)].join('; '));
    const p = store.load(ctx.id);
    writeJson(path.join(ctx.dir, 'storyboard.json'), { title: concept.title, language: concept.language, durationSec: concept.durationSec, format: concept.format, scenes: concept.scenes.map((s) => ({ id: s.id, type: s.type, headline: s.headline, subline: s.subline, voiceover: s.voiceover, screenshot: s.screenshot, plannedDuration: s.plannedDuration })), warnings: concept.warnings });
    fs.writeFileSync(path.join(ctx.dir, 'script.txt'), `${concept.title}\n\n` + concept.scenes.map((s, i) => `[${i + 1}] ${s.headline}\n${s.voiceover}\n`).join('\n'));
    if (p.uploads.facts) fs.copyFileSync(path.join(ctx.dir, 'uploads', p.uploads.facts), path.join(ctx.dir, 'product-facts.json'));
    ctx.update((q) => { if (!q.outputs.seed) q.outputs.seed = 1234; });
    return { note: `${concept.scenes.length} scenes validated` };
  }

  async stage_images(ctx, concept) {
    const p = store.load(ctx.id); const size = pricing.imageSizeFor(concept.format); const final = pricing.dimsFor(concept.format, 1080);
    const used = [...new Set(concept.scenes.map((s) => s.bg))]; const jobs = []; const map = { bg: {}, ui: {}, logo: null, fonts: [] };
    let i = 0;
    for (const im of concept.assets.images.filter((x) => used.includes(x.id))) {
      ctx.progress('images', i++ / (used.length + 1), `image ${im.id}`);
      const r = await ctx.providers.image({ id: im.id, prompt: im.prompt, size, quality: p.settings.imageQuality });
      const dst = path.join(ctx.dir, 'assets', `bg-${im.id}.jpg`);
      jobs.push({ op: 'cover', src: path.join(ctx.dir, r.file), dst, w: final.width, h: final.height, quality: 92 }); map.bg[im.id] = rel(ctx.dir, dst);
    }
    for (const s of concept.scenes) if (s.screenshot && !map.ui[s.screenshot]) {
      const src = path.join(ctx.dir, 'uploads', s.screenshot); if (!fs.existsSync(src)) throw new Error(`screenshot not found: ${s.screenshot}`);
      const dst = path.join(ctx.dir, 'assets', `ui-${slug(path.parse(s.screenshot).name)}.png`); jobs.push({ op: 'fit', src, dst, maxw: 2400 }); map.ui[s.screenshot] = rel(ctx.dir, dst);
    }
    if (concept.brand.logo) { const src = path.join(ctx.dir, 'uploads', concept.brand.logo); if (fs.existsSync(src)) {
        if (/\.svg$/i.test(src)) { // vector logo: give it an explicit size (viewBox) so the canvas can draw it; the browser rasterises it
          let svg = fs.readFileSync(src, 'utf8'); const vb = svg.match(/viewBox=["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
          const tag = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
          if (vb && !/\swidth=/i.test(tag)) svg = svg.replace(/<svg\b/i, `<svg width="${Math.round(vb[1])}" height="${Math.round(vb[2])}"`);
          fs.writeFileSync(path.join(ctx.dir, 'assets', 'logo.svg'), svg); map.logo = 'assets/logo.svg';
        } else { const dst = path.join(ctx.dir, 'assets', 'logo.png'); jobs.push({ op: 'fit', src, dst, maxw: 600 }); map.logo = 'assets/logo.png'; }
      } }
    for (const f of p.uploads.fonts) map.fonts.push({ family: f.family, file: `uploads/${f.file}`, weight: f.weight || 400, style: f.style || 'normal' });
    const jf = path.join(ctx.dir, 'analysis', 'layers-job.json'); writeJson(jf, jobs); await py('prepare_layers.py', [jf]); fs.rmSync(jf, { force: true });
    ctx.update((q) => { q.outputs.assetsMap = map; });
    return { note: `${used.length} backgrounds, ${Object.keys(map.ui).length} UI screenshots prepared` };
  }

  async stage_music(ctx, concept) {
    if (!(concept.musicLevel > 0)) { ctx.update((q) => { delete q.outputs.music; }); return { skipped: true, note: 'music off' }; }
    const r = await ctx.providers.music({ prompt: concept.musicPrompt, seconds: pricing.musicSeconds(concept.durationSec) });
    const wav = path.join(ctx.dir, 'assets', 'music-analysis-src.wav');
    await ffmpeg(['-i', path.join(ctx.dir, r.file), '-ac', '1', '-ar', '22050', wav]);
    ctx.update((q) => { q.outputs.music = { file: r.file, requestId: r.requestId, mock: !!r.mock, placeholder: !!r.placeholder, analysisSrc: rel(ctx.dir, wav) }; });
    return { note: `${r.cached ? 'cached' : 'generated'}${r.placeholder ? ' (local placeholder)' : ''}` };
  }

  async voiceFor(ctx, concept, scene) {
    const p = store.load(ctx.id); const attempt = (p.outputs.ttsAttempt || {})[scene.id] || 0;
    const text = pricing.applyPronunciations(scene.voiceover, concept.voice.pronunciations);
    const r = await ctx.providers.tts({ sceneId: scene.id, text, voice: concept.voice.voice, language: concept.language, attempt });
    const duration = await audioDuration(path.join(ctx.dir, r.file));
    return { file: r.file, duration, inputHash: r.inputHash, url: r.url, text, mock: !!r.mock, placeholder: !!r.placeholder, requestId: r.requestId };
  }

  async stage_voice(ctx, concept) {
    const out = {}; const list = concept.scenes.filter((s) => s.voiceover && s.voiceover.trim()); let i = 0;
    for (const s of list) { ctx.progress('voice', i++ / list.length, `voice ${s.id}`); out[s.id] = await this.voiceFor(ctx, concept, s); }
    ctx.update((q) => { q.outputs.voice = out; });
    return { note: `${list.length} lines, ${roundTo(Object.values(out).reduce((n, v) => n + v.duration, 0), 1)}s of speech` };
  }

  async stage_whisper(ctx, concept) {
    const p0 = store.load(ctx.id); const voice = { ...(p0.outputs.voice || {}) }; const scenes = {}; let mockAny = false;
    const maxRetries = p0.settings.maxRetries;
    for (const s of concept.scenes.filter((x) => voice[x.id])) {
      let attempts = 0;
      for (;;) {
        const entry = voice[s.id];
        const w = await ctx.providers.whisper({ sceneId: s.id, language: concept.language, voiceEntry: { ...entry, inputHash: entry.inputHash || sha(entry.file) } });
        mockAny = mockAny || !!w.mock;
        const cmp = compareTranscript(entry.text, w.text);
        scenes[s.id] = { sceneId: s.id, target: entry.text, transcript: w.text, requestId: w.requestId, ...cmp, ttsAttempts: attempts, words: w.words || [] };
        if (cmp.pass || w.mock || !ctx.mode.allowPaid || attempts >= maxRetries) break;
        try {
          attempts++; ctx.update((q) => { q.outputs.ttsAttempt = { ...(q.outputs.ttsAttempt || {}), [s.id]: attempts }; });
          voice[s.id] = await this.voiceFor(ctx, concept, s); ctx.update((q) => { q.outputs.voice = voice; });
        } catch (e) { if (e instanceof SpendLimitError) { scenes[s.id].note = 'auto-retry skipped: ' + e.message; break; } throw e; }
      }
      if (scenes[s.id].words.length) voice[s.id] = { ...voice[s.id], words: scenes[s.id].words.map((x) => ({ start: x.start, end: x.end })) };
    }
    const all = Object.values(scenes);
    const doc = { checkedAt: new Date().toISOString(), mock: mockAny, note: 'Whisper is a content check (missing, cut-off or different words). It does not prove correct pronunciation.', overallPass: all.every((v) => v.pass), scenes };
    writeJson(path.join(ctx.dir, 'voice-validation.json'), doc);
    ctx.update((q) => { q.outputs.voice = voice; });
    return { note: mockAny ? 'mock: not tested' : `${all.filter((v) => v.pass).length}/${all.length} scenes match the script` };
  }

  async stage_analysis(ctx) {
    const p = store.load(ctx.id); const out = path.join(ctx.dir, 'analysis', 'music-analysis.json');
    if (!p.outputs.music) { writeJson(out, { source: null, beats: [], onsets: [], energy: [], silences: [], note: 'music is off' }); return { skipped: true, note: 'no music' }; }
    await py('analyze_music.py', [path.join(ctx.dir, p.outputs.music.analysisSrc), out]);
    const a = readJson(out); return { note: `${a.bpm} BPM, ${a.beats.length} beats, ${a.onsets.length} onsets` };
  }

  buildTimelineFor(ctx, p, concept) {
    const analysis = readJson(path.join(ctx.dir, 'analysis', 'music-analysis.json'), { beats: [] });
    const voice = {}; for (const [id, v] of Object.entries(p.outputs.voice || {})) voice[id] = { file: v.file, duration: v.duration, words: v.words };
    const repair = p.outputs.repair || {};
    return buildTimeline(concept, {
      mode: { short: ctx.mode.short, fps: ctx.mode.fps }, seed: p.outputs.seed || 1234, textScale: repair.textScale, duckDb: repair.duckDb,
      voice, music: p.outputs.music ? { file: p.outputs.music.file, beats: analysis.beats, bpm: analysis.bpm } : null, assets: p.outputs.assetsMap,
    });
  }

  async stage_animation(ctx, concept) {
    const p = store.load(ctx.id); const tl = this.buildTimelineFor(ctx, p, concept);
    writeJson(path.join(ctx.dir, 'timeline.json'), tl);
    const { browser, page } = await render.openPlayer(ctx.origin, ctx.id);
    try {
      const det = await render.checkDeterminism(page, tl); writeJson(path.join(ctx.dir, 'analysis', 'determinism.json'), det);
      const info = await render.pageInfo(page);
      if (!det.ok) throw new Error('renderFrame(t) is not deterministic: ' + JSON.stringify(det.samples));
      if (info.missing.length) throw new Error('assets failed to load in the engine: ' + info.missing.join(', '));
      return { note: `${tl.scenes.length} scenes, ${tl.duration}s, fx=${info.fx}, deterministic` };
    } finally { await browser.close(); }
  }

  async stage_render(ctx, concept) {
    const p = store.load(ctx.id); const dir = ctx.dir; const tl = readJson(path.join(dir, 'timeline.json')); const name = ctx.mode.name;
    const { browser, page, problems } = await render.openPlayer(ctx.origin, ctx.id);
    let layout; let info; const keyFiles = []; const labels = [];
    try {
      layout = await render.layoutSamples(page, tl);
      const total = await render.renderFrames(page, tl, path.join(dir, 'frames'), { quality: ctx.mode.jpegQ, onProgress: (f) => ctx.progress('render', f * 0.8, `frames ${Math.round(f * 100)}%`) });
      // key frames (PNG) for contact sheet + preview
      for (const s of tl.scenes) { const t = s.start + Math.min(s.duration * 0.6, s.duration - 0.2); const f = path.join(dir, 'analysis', `key-${s.id}.png`); fs.writeFileSync(f, Buffer.from(await render.grab(page, t, 'image/png'), 'base64')); keyFiles.push(f); labels.push(`${s.id} ${s.type} @${t.toFixed(1)}s`); }
      info = await render.pageInfo(page); info.problems = problems.slice(); info.frames = total;
    } finally { await browser.close(); }
    ctx.progress('render', 0.85, 'mixing audio');
    const audio = await render.mixAudio(dir, tl); render.writeSrt(dir, tl);
    ctx.progress('render', 0.9, 'encoding MP4 + WebM');
    const files = await render.encode(dir, tl, { draft: name === 'draft', name });
    const hero = keyFiles[Math.max(0, tl.scenes.findIndex((s) => s.type === 'product'))] || keyFiles[0];
    fs.copyFileSync(hero, path.join(dir, 'output', 'preview.png'));
    const cj = path.join(dir, 'analysis', 'contact-job.json'); writeJson(cj, { files: keyFiles, labels, out: path.join(dir, 'output', 'contact-sheet.png'), thumbWidth: tl.width > tl.height ? 480 : 260, cols: tl.width > tl.height ? 3 : 4 });
    await py('qa_tools.py', ['contact', cj, path.join(dir, 'analysis', 'contact-out.json')]); fs.rmSync(cj, { force: true });
    writeJson(path.join(dir, 'analysis', 'render-info.json'), { layout, info, files, audio, name });
    ctx.update((q) => { q.outputs.render = { files, audio, name, at: new Date().toISOString() }; });
    return { note: `${info.frames} frames -> ${files.mp4}, ${files.webm}` };
  }

  async stage_qa(ctx, concept) {
    const p = store.load(ctx.id); const dir = ctx.dir; const tl = readJson(path.join(dir, 'timeline.json')); const ri = readJson(path.join(dir, 'analysis', 'render-info.json'));
    const attempts = p.outputs.repairLog || [];
    const report = await runQa({ dir, timeline: tl, files: ri.files, layoutReports: ri.layout, page: ri.info, problems: ri.info.problems || [], voiceValidation: readJson(path.join(dir, 'voice-validation.json'), null), framesDir: path.join(dir, 'frames'), mock: p.mock, placeholders: !p.mock && !ctx.mode.allowPaid, project: p, concept, mode: ctx.mode.name, attempts });
    writeJson(path.join(dir, 'qa-report.json'), report);
    if (report.overall === 'fail' && attempts.length < p.settings.maxRenderAttempts) {
      const plan = planRepair(report, tl);
      if (plan.repairable) {
        ctx.update((q) => { q.outputs.repair = { ...(q.outputs.repair || {}), ...plan.fix }; q.outputs.repairLog = [...attempts, { at: new Date().toISOString(), failed: report.failedChecks, actions: plan.notes }]; for (const s of ['animation', 'render', 'qa']) q.stages[s].status = 'pending'; });
        return { repair: true, note: 'QA failed (' + report.failedChecks.join(', ') + '); repairing: ' + plan.notes.join(', ') };
      }
    }
    if (!fs.existsSync(path.join(dir, ri.files.mp4))) throw new Error('video file does not exist after render');
    return { note: `${report.overall.toUpperCase()}: ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.warn} warn, ${report.summary.notTested} not tested` };
  }
}

module.exports = { Runner, normaliseDurations, validateStoryboard, estimateFor, previewTimeline, loadConcept, MODES, modeFor };
