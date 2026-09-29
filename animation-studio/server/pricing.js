'use strict';
const path = require('path');
const { readJson } = require('./util');
const config = require('./config');

const table = () => readJson(path.join(config.ROOT, 'presets', 'pricing.json'));

const FORMATS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1] };

// Output resolution: `short` = length of the short side (e.g. 1080). Even numbers only.
function dimsFor(format, short) {
  const [a, b] = FORMATS[format] || FORMATS['16:9'];
  const s = Math.round(short / 2) * 2;
  const long = Math.round((s * Math.max(a, b)) / Math.min(a, b) / 2) * 2;
  return a >= b ? { width: long, height: s } : { width: s, height: long };
}

// GPT Image size constraints: multiples of 16, >= 655,360 px. Background assets are cropped to fit later.
function imageSizeFor(format) {
  if (format === '9:16') return { width: 1088, height: 1920 };
  if (format === '1:1') return { width: 1024, height: 1024 };
  return { width: 1920, height: 1088 };
}

function imageUnitUsd(size, quality) {
  const rows = table().image.perImageUsd;
  const px = size.width * size.height;
  let best = null;
  for (const [k, v] of Object.entries(rows)) {
    const [w, h] = k.split('x').map(Number);
    const d = Math.abs(w * h - px);
    if (!best || d < best.d) best = { d, v, ref: w * h };
  }
  const base = best.v[quality];
  return base == null ? null : (base * px) / best.ref; // scaled by pixel count: an estimate
}

function musicSeconds(targetSec) { return Math.max(3, Math.min(600, Math.ceil(targetSec * 1.2 + 2))); }

// cachedKeys: set of paid-call cache keys that already exist (not re-billed).
function estimate(concept, settings, have = {}) {
  const t = table();
  const items = [];
  const size = imageSizeFor(concept.format);
  const quality = settings.imageQuality || 'medium';
  const imgUnit = imageUnitUsd(size, quality);
  const imgs = concept.assets.images.filter((i) => !have[`image:${i.id}`]);
  items.push({ stage: 'images', label: `${imgs.length} × GPT Image 2.5 Sunburst (${size.width}×${size.height}, ${quality})`, usd: imgUnit == null ? null : imgUnit * imgs.length });

  if (concept.musicLevel > 0 && !have.music) {
    const mins = Math.ceil(musicSeconds(concept.durationSec) / 60);
    items.push({ stage: 'music', label: `ElevenLabs Music, ${mins} started minute(s)`, usd: mins * t.music.perStartedMinuteUsd });
  } else items.push({ stage: 'music', label: 'Music: off or cached', usd: 0 });

  const chars = concept.scenes.filter((s) => s.voiceover && !have[`tts:${s.id}`]).reduce((n, s) => n + applyPronunciations(s.voiceover, concept.voice.pronunciations).length, 0);
  items.push({ stage: 'voice', label: `ElevenLabs TTS v3, ${chars} characters`, usd: (chars / 1000) * t.tts.per1000CharsUsd });
  items.push({ stage: 'whisper', label: 'Whisper check (price not published as a number)', usd: t.stt.perRequestUsd });

  const known = items.filter((i) => i.usd != null).reduce((n, i) => n + i.usd, 0);
  const retryAllowanceUsd = (chars / 1000) * t.tts.per1000CharsUsd * (settings.maxRetries || 0) * 0.5; // worst case: half the script re-voiced per retry round
  return {
    verifiedOn: t.verifiedOn,
    items,
    knownUsd: round4(known),
    unknownParts: items.filter((i) => i.usd == null).map((i) => i.stage),
    retryAllowanceUsd: round4(retryAllowanceUsd),
    limitUsd: settings.maxSpendUsd,
    withinLimit: known <= settings.maxSpendUsd,
  };
}
const round4 = (x) => Math.round(x * 1e4) / 1e4;

function applyPronunciations(text, map = {}) {
  let out = text;
  for (const [word, spoken] of Object.entries(map)) out = out.split(word).join(spoken);
  return out;
}

module.exports = { dimsFor, imageSizeFor, imageUnitUsd, musicSeconds, estimate, applyPronunciations, table };
