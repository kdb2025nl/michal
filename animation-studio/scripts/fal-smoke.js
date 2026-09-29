'use strict';
// Minimal REAL integration test against Fal (needs FAL_KEY). Hard cap: $0.05. Costs roughly $0.01:
// 1 low-quality image + 1 short TTS line + Whisper on it. Music is skipped here (min. billing unit is $0.60).
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-smoke-'));
const config = require('../server/config');
if (!config.hasFalKey()) { console.log('FAL_KEY not set - skipping real Fal smoke test (set it in .env to run).'); process.exit(0); }
const { Providers } = require('../server/providers');
const { compareTranscript } = require('../server/voicecheck');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-smoke-proj-'));
  const p = new Providers({ dir, settings: { maxSpendUsd: 0.05, maxRetries: 1, imageQuality: 'low' }, ledger: { spentUsd: 0, calls: [] }, mock: false, allowPaid: true, consentFiles: [], log: (m) => console.log('  ', m) });
  const img = await p.image({ id: 'smoke', prompt: 'Abstract soft blue gradient background with subtle geometric shapes. No text, no logos, no interface.', size: { width: 1024, height: 1024 }, quality: 'low' });
  console.log('image ok', img.requestId, img.file);
  const text = 'Overdue invoices need a clear process.';
  const v = await p.tts({ sceneId: 'smoke', text, voice: 'Aria', language: 'en' }); console.log('tts ok', v.requestId, v.file);
  const w = await p.whisper({ sceneId: 'smoke', language: 'en', voiceEntry: { ...v } }); console.log('whisper ok', w.requestId, JSON.stringify(w.text));
  console.log('match:', JSON.stringify(compareTranscript(text, w.text)));
  console.log('spent (estimate):', p.ctx.ledger.spentUsd);
})().catch((e) => { console.error('SMOKE FAILED:', e.message); process.exit(1); });
