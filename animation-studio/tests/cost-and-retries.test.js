'use strict';
const os = require('os'); const fs = require('fs'); const path = require('path');
process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-test-')); process.env.RETRY_BASE_MS = '1';
const test = require('node:test');
const assert = require('node:assert');
const pricing = require('../server/pricing');
const { buildConcept } = require('../server/concept');
const { normaliseDurations } = require('../server/pipeline');
const { Providers, SpendLimitError, ConsentError, assertNoUserFiles } = require('../server/providers');

const mk = (over = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-prov-'));
  const ctx = { dir, settings: { maxSpendUsd: 1, maxRetries: 2, imageQuality: 'medium' }, ledger: { spentUsd: 0, calls: [] }, mock: false, allowPaid: true, consentFiles: [], ...over };
  return new Providers(ctx);
};
process.env.FAL_KEY = 'test-key-not-real';

function stubFal(impl) {
  const modPath = require.resolve('@fal-ai/client'); const real = require(modPath);
  const calls = []; const stub = { fal: { config() {}, subscribe: async (model, opts) => { calls.push({ model, input: opts.input }); return impl(calls.length); }, storage: { upload: async () => 'https://x/y' } } };
  require.cache[modPath].exports = stub; return { calls, restore: () => { require.cache[modPath].exports = real; } };
}

test('estimate: music billed per started minute, TTS per 1000 chars, images by size/quality', () => {
  const c = normaliseDurations(buildConcept({ prompt: 'Intro sentence here. Step one -> Step two', durationSec: 30, format: '16:9' }));
  const est = pricing.estimate(c, { imageQuality: 'medium', maxSpendUsd: 2, maxRetries: 2 });
  const music = est.items.find((i) => i.stage === 'music'); assert.equal(music.usd, 0.6);
  const chars = c.scenes.reduce((n, s) => n + s.voiceover.length, 0); assert.ok(Math.abs(est.items.find((i) => i.stage === 'voice').usd - chars / 10000) < 1e-9);
  const img = est.items.find((i) => i.stage === 'images'); assert.ok(img.usd > 0.02 && img.usd < 0.05, 'three medium 1920x1088 images ~ $0.03: ' + img.usd);
  assert.deepEqual(est.unknownParts, ['whisper']); assert.equal(est.withinLimit, true);
  assert.equal(pricing.estimate(c, { imageQuality: 'medium', maxSpendUsd: 0.1, maxRetries: 0 }).withinLimit, false);
  const cached = pricing.estimate(c, { imageQuality: 'medium', maxSpendUsd: 2, maxRetries: 0 }, { music: true });
  assert.equal(cached.items.find((i) => i.stage === 'music').usd, 0, 'cached music is not billed again');
});

test('spend limit refuses a call BEFORE anything is sent to Fal', async () => {
  const p = mk({ settings: { maxSpendUsd: 0.01, maxRetries: 2, imageQuality: 'medium' } }); const s = stubFal(() => ({ data: {}, requestId: 'r' }));
  try { await assert.rejects(() => p.music({ prompt: 'calm', seconds: 30 }), SpendLimitError); assert.equal(s.calls.length, 0); assert.equal(p.ctx.ledger.spentUsd, 0); } finally { s.restore(); }
});

test('spend accumulates across calls and blocks once the cap would be exceeded', async () => {
  const p = mk({ settings: { maxSpendUsd: 0.7, maxRetries: 0, imageQuality: 'medium' } }); const s = stubFal(() => ({ data: { audio: { url: 'http://127.0.0.1:9/none' } }, requestId: 'r' }));
  p.download = async (u, dest) => fs.writeFileSync(dest, 'x');
  try { await p.music({ prompt: 'a', seconds: 30 }); assert.equal(p.ctx.ledger.spentUsd, 0.6); await assert.rejects(() => p.music({ prompt: 'b different', seconds: 30 }), SpendLimitError); assert.equal(s.calls.length, 1); } finally { s.restore(); }
});

test('retry: transient failures are retried up to maxRetries, billed once, then succeed', async () => {
  const p = mk(); let n = 0; const s = stubFal(() => { n++; if (n < 3) { const e = new Error('503 upstream'); e.status = 503; throw e; } return { data: { audio: { url: 'u' } }, requestId: 'req-1' }; });
  p.download = async (u, dest) => fs.writeFileSync(dest, 'x');
  try { const r = await p.music({ prompt: 'ok', seconds: 10 }); assert.equal(s.calls.length, 3); assert.equal(r.requestId, 'req-1'); assert.equal(p.ctx.ledger.calls.length, 1); } finally { s.restore(); }
});

test('retry: gives up after maxRetries and does not bill failures; 4xx is not retried', async () => {
  const p = mk({ settings: { maxSpendUsd: 1, maxRetries: 1, imageQuality: 'medium' } }); const s = stubFal(() => { const e = new Error('boom'); e.status = 500; throw e; });
  try { await assert.rejects(() => p.music({ prompt: 'x', seconds: 10 }), /boom/); assert.equal(s.calls.length, 2); assert.equal(p.ctx.ledger.spentUsd, 0); } finally { s.restore(); }
  const s2 = stubFal(() => { const e = new Error('bad input'); e.status = 422; throw e; });
  try { await assert.rejects(() => p.music({ prompt: 'y', seconds: 10 }), /bad input/); assert.equal(s2.calls.length, 1); } finally { s2.restore(); }
});

test('cached paid results are reused: same input never hits Fal twice', async () => {
  const p = mk(); const s = stubFal(() => ({ data: { audio: { url: 'u' } }, requestId: 'r' })); p.download = async (u, dest) => fs.writeFileSync(dest, 'x');
  try { await p.music({ prompt: 'same', seconds: 10 }); const again = await p.music({ prompt: 'same', seconds: 10 }); assert.equal(s.calls.length, 1); assert.equal(again.cached, true); assert.equal(p.ctx.ledger.calls.length, 1); } finally { s.restore(); }
});

test('user files are never sent to Fal without consent; FAL_KEY never appears in errors', async () => {
  assert.throws(() => assertNoUserFiles({ image_url: 'data:image/png;base64,AAAA' }), ConsentError);
  assert.throws(() => assertNoUserFiles({ image_url: '/home/user/x/uploads/shot.png' }), ConsentError);
  assert.doesNotThrow(() => assertNoUserFiles({ prompt: 'plain text', audio_url: 'https://v3.fal.media/files/a.mp3' }));
  const p = mk(); const s = stubFal(() => { throw new Error('auth failed for key ' + process.env.FAL_KEY); });
  p.ctx.settings.maxRetries = 0;
  try { await assert.rejects(() => p.music({ prompt: 'k', seconds: 10 }), (e) => !e.message.includes('test-key-not-real')); } finally { s.restore(); }
});
