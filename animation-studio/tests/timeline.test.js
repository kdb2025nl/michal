'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildConcept } = require('../server/concept');
const { buildTimeline, chunkCaption } = require('../server/timeline');
const { validateTimeline } = require('../server/schemas');
const { normaliseDurations } = require('../server/pipeline');

const concept = () => normaliseDurations(buildConcept({ prompt: 'Intro line. Step one -> Step two -> Step three', durationSec: 30, format: '16:9', language: 'en' }));

test('scene durations sum exactly to timeline duration and are contiguous', () => {
  const tl = buildTimeline(concept());
  const sum = tl.scenes.reduce((n, s) => n + s.duration, 0);
  assert.ok(Math.abs(sum - tl.duration) < 0.011);
  assert.ok(validateTimeline(tl).ok);
  tl.scenes.reduce((t, s) => { assert.ok(Math.abs(s.start - t) < 0.011); return s.start + s.duration; }, 0);
});

test('validateTimeline rejects gaps and wrong totals', () => {
  const tl = buildTimeline(concept());
  const bad = JSON.parse(JSON.stringify(tl)); bad.scenes[1].start += 0.5;
  assert.equal(validateTimeline(bad).ok, false);
  const bad2 = JSON.parse(JSON.stringify(tl)); bad2.duration += 3;
  assert.equal(validateTimeline(bad2).ok, false);
});

test('scene length grows to fit measured voice-over (never cuts speech)', () => {
  const c = concept(); const voice = { s1: { file: 'a.mp3', duration: 9.0 } };
  const tl = buildTimeline(c, { voice });
  assert.ok(tl.scenes[0].duration >= 9.0 + 0.5);
  const vt = tl.audio.voice[0]; assert.ok(vt.start + vt.duration <= tl.scenes[0].start + tl.scenes[0].duration);
});

test('scene boundaries and entrances snap to music beats', () => {
  const beats = []; for (let t = 0.3; t < 60; t += 0.5) beats.push({ t: +t.toFixed(3), strength: 0.7 });
  const tl = buildTimeline(concept(), { music: { file: 'm.mp3', beats, bpm: 120 } });
  for (const s of tl.scenes.slice(1)) {
    const d = Math.min(...beats.map((b) => Math.abs(b.t - s.start)));
    assert.ok(d < 0.035 + 1e-6, `scene ${s.id} start ${s.start} is ${d}s from nearest beat`); // frame quantisation tolerance
  }
  const acc = tl.scenes.flatMap((s) => s.syncMarkers).filter((m) => m.accent);
  assert.ok(acc.length <= tl.scenes.length * 2);
});

test('captions stay inside their scene and are balanced', () => {
  const tl = buildTimeline(concept());
  for (const c of tl.captions) { const s = tl.scenes.find((x) => x.id === c.sceneId); assert.ok(c.start >= s.start && c.end <= s.start + s.duration + 1e-6); assert.ok(c.end > c.start); }
  const ch = chunkCaption('Start the reminder workflow that fits the situation.');
  assert.ok(ch.every((c) => c.length >= 2));
});

test('dimensions per format are even and match aspect', () => {
  for (const [f, w, h] of [['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080]]) {
    const c = normaliseDurations(buildConcept({ prompt: 'One sentence only.', durationSec: 20, format: f })); const tl = buildTimeline(c, { mode: { short: 1080, fps: 30 } });
    assert.equal(tl.width, w); assert.equal(tl.height, h);
  }
});
