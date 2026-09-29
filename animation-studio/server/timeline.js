'use strict';
const { dimsFor } = require('./pricing');
const { validateTimeline } = require('./schemas');

const FPS = 30;
const LEAD = 0.5;            // silence before voice-over starts inside a scene
const TAIL = { hook: 0.8, concept: 0.9, product: 1.8, cta: 2.2 }; // reading time for UI / CTA
const MAX_SNAP_EXTEND = 0.45; // scene may be lengthened by this much to land on a beat
const SNAP_ENTRY = 0.2;       // element entrances snap to a beat within this window

const q = (t) => Math.round(t * FPS) / FPS;
const qc = (t) => Math.ceil(t * FPS - 1e-9) / FPS;
const estimateSpeech = (text) => (text ? Math.max(1.6, text.trim().split(/\s+/).length / 2.5) : 0);

function nearestBeat(t, beats, window) {
  let best = null;
  for (const b of beats) { const d = Math.abs(b.t - t); if (d <= window && (!best || d < best.d)) best = { d, b }; }
  return best ? best.b : null;
}
function firstBeatAtOrAfter(t, beats, maxExtend) {
  for (const b of beats) if (b.t >= t - 1e-6) return b.t - t <= maxExtend ? b : null;
  return null;
}

// Split caption text into readable chunks (<= 7 words / 42 chars).
function chunkCaption(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const n = Math.max(Math.ceil(words.length / 7), Math.ceil(words.join(' ').length / 42));
  const size = Math.ceil(words.length / n); // even chunks: no orphan one-word captions
  const chunks = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size));
  return chunks;
}

/**
 * ctx = { mode:{short,fps}, voice:{sceneId:{file,duration,words?:[{start,end}]}}, music:{file, beats:[{t,strength}], bpm}|null,
 *         assets:{bg:{id:file}, ui:{name:file}, logo, fonts}, seed, textScale, duckDb }
 */
function buildTimeline(concept, ctx = {}) {
  const fps = ctx.mode?.fps || FPS;
  const short = ctx.mode?.short || 1080;
  const { width, height } = dimsFor(concept.format, short);
  const beats = ctx.music?.beats || [];
  const scenes = []; const captions = []; const voiceTracks = [];
  let cursor = 0;

  concept.scenes.forEach((s, idx) => {
    const v = ctx.voice?.[s.id] || null;
    const speech = v ? v.duration : estimateSpeech(s.voiceover);
    const needed = LEAD + speech + (TAIL[s.type] ?? 1);
    let dur = qc(Math.max(needed, s.plannedDuration));
    const endBeat = firstBeatAtOrAfter(cursor + dur, beats, MAX_SNAP_EXTEND);
    if (endBeat && idx < concept.scenes.length - 1) dur = qc(endBeat.t - cursor);
    const start = q(cursor);
    const snap = (rel) => { const b = nearestBeat(start + rel, beats, SNAP_ENTRY); return b ? Math.max(0.08, Math.min(0.7, +(b.t - start).toFixed(3))) : rel; };

    const layers = [{ id: `${s.id}-bg`, kind: 'bg', asset: s.bg, in: 0, dur: 0.5 }];
    layers.push({ id: `${s.id}-headline`, kind: 'headline', text: s.headline, in: snap(0.15), dur: 0.55 });
    if (s.subline) layers.push({ id: `${s.id}-subline`, kind: 'subline', text: s.subline, in: snap(0.45), dur: 0.5 });
    if (s.type === 'product' && s.screenshot) layers.push({ id: `${s.id}-ui`, kind: 'ui', asset: s.screenshot, in: snap(0.2), dur: 0.6 });
    if (s.type === 'cta') {
      layers.push({ id: `${s.id}-cta`, kind: 'cta', text: concept.cta.text, url: concept.cta.url || '', in: snap(0.55), dur: 0.5 });
    }
    if (concept.brand.logo) layers.push({ id: `${s.id}-logo`, kind: 'logo', asset: 'logo', in: 0.1, dur: 0.4 });

    // camera: gentle push-in; product scenes may zoom toward a focus rectangle
    const camera = [{ t: 0, zoom: 1, cx: 0.5, cy: 0.5 }];
    if (s.type === 'product' && s.focus) {
      const f = s.focus; const z = Math.min(1.45, 0.85 / Math.max(f.w, f.h));
      camera.push({ t: Math.min(dur * 0.35, 1.6), zoom: 1, cx: 0.5, cy: 0.5 }, { t: dur, zoom: Math.max(1.05, z), cx: f.x + f.w / 2, cy: f.y + f.h / 2 });
    } else camera.push({ t: dur, zoom: s.type === 'product' ? 1.05 : 1.03, cx: 0.5, cy: 0.5 });

    // sync markers from the music analysis (only used for entrances and subtle accents)
    const inScene = beats.filter((b) => b.t >= start && b.t < start + dur);
    const strong = inScene.filter((b) => b.strength >= 0.6).slice(0, 2);
    const syncMarkers = inScene.map((b) => ({ t: +(b.t - start).toFixed(3), type: 'beat', strength: +b.strength.toFixed(2), accent: strong.includes(b) && b.t - start > 0.1 }));

    // captions: split voice-over into chunks timed against the voice (word times when available)
    const capText = (s.caption || s.voiceover || '').trim();
    if (capText) {
      const chunks = chunkCaption(capText);
      const vStart = start + LEAD;
      const totalChars = chunks.reduce((n, c) => n + c.join(' ').length, 0) || 1;
      const words = v?.words && v.words.length ? v.words : null;
      const nWords = chunks.reduce((n, c) => n + c.length, 0);
      let acc = 0; let wIdx = 0;
      chunks.forEach((c, i) => {
        let cs; let ce;
        if (words && Math.abs(words.length - nWords) <= Math.max(2, nWords * 0.25)) {
          const a = Math.min(words.length - 1, Math.round((wIdx / nWords) * words.length));
          const b = Math.min(words.length - 1, Math.round(((wIdx + c.length) / nWords) * words.length) - 1);
          cs = vStart + words[a].start; ce = vStart + Math.max(words[b].end, words[a].start + 0.4);
        } else {
          cs = vStart + (acc / totalChars) * speech; ce = vStart + ((acc + c.join(' ').length) / totalChars) * speech;
        }
        acc += c.join(' ').length; wIdx += c.length;
        captions.push({ sceneId: s.id, start: +cs.toFixed(3), end: +Math.min(ce + (i === chunks.length - 1 ? 0.5 : 0.05), start + dur - 0.05).toFixed(3), text: c.join(' ') });
      });
    }
    if (v) voiceTracks.push({ sceneId: s.id, file: v.file, start: +(start + LEAD).toFixed(3), duration: +v.duration.toFixed(3) });

    scenes.push({
      id: s.id, type: s.type, start, duration: dur, layers, camera, syncMarkers,
      transitionIn: idx === 0 ? { type: 'none', duration: 0 } : { type: s.type === 'product' && concept.scenes[idx - 1].type === 'product' ? 'slide' : 'dissolve', duration: 0.4 },
    });
    cursor = start + dur;
  });

  // force exact continuity: recompute starts from quantised durations
  let t = 0;
  for (const sc of scenes) { sc.start = +t.toFixed(4); t += sc.duration; sc.duration = +sc.duration.toFixed(4); }
  const duration = +t.toFixed(4);
  for (const c of captions) c.end = Math.min(c.end, duration);

  const timeline = {
    version: 1,
    seed: ctx.seed ?? 1234,
    fps, width, height, format: concept.format,
    duration, targetDuration: concept.durationSec,
    style: {
      primaryColor: concept.brand.primaryColor, accentColor: concept.brand.accentColor, textColor: concept.brand.textColor || '#FFFFFF',
      fontFamily: concept.brand.fontFamily, textScale: ctx.textScale ?? 1, motion: 'subtle', brandName: concept.brand.name,
    },
    safe: concept.format === '9:16' ? { x: 0.08, top: 0.09, bottom: 0.16 } : concept.format === '1:1' ? { x: 0.08, top: 0.08, bottom: 0.12 } : { x: 0.06, top: 0.08, bottom: 0.12 },
    audio: {
      voice: voiceTracks,
      music: ctx.music?.file && concept.musicLevel > 0 ? { file: ctx.music.file, gain: concept.musicLevel, loop: true } : null,
      duckDb: ctx.duckDb ?? 14,
    },
    sync: { source: ctx.music ? 'music-analysis.json' : 'none', bpm: ctx.music?.bpm || null },
    assets: ctx.assets || { bg: {}, ui: {}, logo: null, fonts: [] },
    scenes, captions,
  };
  const v = validateTimeline(timeline);
  if (!v.ok) throw new Error('timeline invalid: ' + v.errors.join('; '));
  return timeline;
}

module.exports = { buildTimeline, chunkCaption, estimateSpeech, FPS, LEAD };
