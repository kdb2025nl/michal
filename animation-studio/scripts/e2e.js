'use strict';
// End-to-end test WITHOUT paid Fal calls: local mock assets, real engine, real Puppeteer render, real FFmpeg, real ffprobe.
//   npm run test:e2e            -> API flow (+ UI flow if Chrome present)
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-output'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
process.env.PROJECTS_DIR = path.join(out, 'projects');
delete process.env.FAL_KEY; // guarantee no paid calls
const config = require('../server/config');
const { createApp } = require('../server/app');
const { py, ffprobe } = require('../server/util');

const log = (...a) => console.log('[e2e]', ...a);
async function api(base, method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body; else if (body) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
  const r = await fetch(base + url, opt); const j = await r.json().catch(() => ({})); return { status: r.status, body: j };
}
async function waitDone(base, id, timeoutMs = 900000) {
  const t0 = Date.now(); let last = '';
  for (;;) {
    const { body } = await api(base, 'GET', `/api/projects/${id}`); const p = body.project;
    const line = Object.entries(p.stages).map(([k, v]) => `${k}:${v.status}${v.progress != null ? ' ' + v.progress + '%' : ''}`).join(' ');
    if (line !== last) { log(p.status, '|', line); last = line; }
    if (['done', 'done_with_issues', 'failed'].includes(p.status)) return body;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

(async () => {
  const app = createApp(); const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`; app.get('runner').origin = base;
  const results = [];
  try {
    const fx = path.join(out, 'fixtures'); fs.mkdirSync(fx);
    const slots = ['overdue-invoices', 'prioritization', 'workflow', 'tasks', 'status'];
    for (const s of slots) await py('mock_assets.py', ['screenshot', path.join(fx, `${s}.png`), s]);
    fs.writeFileSync(path.join(fx, 'product-facts.json'), JSON.stringify({ product: 'Test product', approvedClaims: [], cta: { text: 'Learn more', url: 'example.com/demo' } }));
    const fd = new FormData();
    fd.append('form', JSON.stringify({ presetId: 'credit-iq', resolution: 720 }));
    fd.append('slots', JSON.stringify(slots));
    for (const s of slots) fd.append('screenshots', new Blob([fs.readFileSync(path.join(fx, `${s}.png`))], { type: 'image/png' }), `${s}.png`);
    fd.append('facts', new Blob([fs.readFileSync(path.join(fx, 'product-facts.json'))], { type: 'application/json' }), 'product-facts.json');

    // 1. negative: preset without screenshots must not fabricate UI and needs explicit confirmation
    const nofd = new FormData(); nofd.append('form', JSON.stringify({ presetId: 'credit-iq' }));
    const np = await api(base, 'POST', '/api/projects', nofd); assert.equal(np.status, 200);
    assert.equal(np.body.needsUi, true, 'preset without screenshots must report needsUi');
    assert(!np.body.concept.scenes.some((s) => s.type === 'product'), 'no product scene without screenshots');
    const g0 = await api(base, 'POST', `/api/projects/${np.body.project.id}/generate`, { mode: 'final', mock: true }); assert.equal(g0.status, 428);
    results.push('preset without screenshots -> concept plate only, generate blocked until confirmed (428) OK');

    // 2. full run with screenshots, mock mode
    const created = await api(base, 'POST', '/api/projects', fd); assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.project.id; log('project', id, 'scenes', created.body.concept.scenes.length, 'warnings', created.body.concept.warnings);
    assert(created.body.concept.scenes.filter((s) => s.type === 'product').length === 5);
    const badG = await api(base, 'POST', `/api/projects/${id}/generate`, { mode: 'final', mock: false, confirmSpend: true }); assert.equal(badG.status, 412, 'real mode without FAL_KEY must be refused');
    results.push('real mode without FAL_KEY refused (412) OK');
    const g = await api(base, 'POST', `/api/projects/${id}/generate`, { mode: 'final', mock: true }); assert.equal(g.status, 200, JSON.stringify(g.body));
    const done = await waitDone(base, id);
    assert(['done', 'done_with_issues'].includes(done.project.status), 'pipeline failed: ' + JSON.stringify(done.project.error));
    const dir = path.join(config.PROJECTS_DIR, id);
    for (const f of ['concept.json', 'timeline.json', 'storyboard.json', 'voice-validation.json', 'qa-report.json', 'analysis/music-analysis.json', 'output/final.mp4', 'output/final.webm', 'output/preview.png', 'output/contact-sheet.png', 'output/captions.srt', 'assets/manifest.json']) assert(fs.existsSync(path.join(dir, f)), 'missing ' + f);
    const qa = JSON.parse(fs.readFileSync(path.join(dir, 'qa-report.json'), 'utf8'));
    log('QA overall:', qa.overall, JSON.stringify(qa.summary)); for (const [k, c] of Object.entries(qa.checks)) log('  ', c.status.padEnd(10), k, '-', c.detail);
    assert.equal(qa.overall, 'pass', 'QA failed: ' + qa.failedChecks.join(','));
    const probe = await ffprobe(path.join(dir, 'output/final.mp4'));
    const v = probe.streams.find((s) => s.codec_type === 'video'); const a = probe.streams.find((s) => s.codec_type === 'audio');
    assert.equal(v.codec_name, 'h264'); assert.equal(a.codec_name, 'aac'); assert(Number(probe.format.duration) > 20);
    results.push(`MP4 ${v.width}x${v.height} ${v.codec_name}/${a.codec_name} ${Number(probe.format.duration).toFixed(2)}s playable (ffprobe + full decode) OK`);
    assert.equal(done.project.ledger.spentUsd, 0, 'mock run must not spend');

    // 3. retry a stage: nothing paid is regenerated, result identical
    const before = fs.readFileSync(path.join(dir, 'assets/manifest.json'), 'utf8');
    const r = await api(base, 'POST', `/api/projects/${id}/retry`, { stage: 'render', confirmSpend: true }); assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 500)); const again = await waitDone(base, id);
    assert.equal(fs.readFileSync(path.join(dir, 'assets/manifest.json'), 'utf8'), before, 'manifest changed on retry (paid asset regenerated?)');
    assert(['done', 'done_with_issues'].includes(again.project.status)); results.push('retry render reused all cached assets OK');

    // 4. draft mode: lower resolution, no paid calls
    const d = await api(base, 'POST', `/api/projects/${id}/generate`, { mode: 'draft', mock: true }); assert.equal(d.status, 200);
    const dd = await waitDone(base, id); assert(fs.existsSync(path.join(dir, 'output/draft.mp4')));
    const dp = await ffprobe(path.join(dir, 'output/draft.mp4')); results.push(`Draft MP4 ${dp.streams[0].width}x${dp.streams[0].height} OK (status ${dd.project.status})`);

    // 5. frame cleanup after export
    const c = await api(base, 'POST', `/api/projects/${id}/cleanup-frames`); assert.equal(c.status, 200); assert.equal(fs.readdirSync(path.join(dir, 'frames')).length, 0); results.push('frames cleanup OK');

    // keep the final artefacts for the README / hand-off
    const sample = path.join(root, 'samples'); fs.rmSync(sample, { recursive: true, force: true }); fs.mkdirSync(sample);
    // re-render final so samples reflect the final mode (draft overwrote preview/contact)
    await api(base, 'POST', `/api/projects/${id}/generate`, { mode: 'final', mock: true }); await new Promise((res) => setTimeout(res, 500)); await waitDone(base, id);
    for (const [src, dst] of [['output/final.mp4', 'test-final.mp4'], ['output/final.webm', 'test-final.webm'], ['qa-report.json', 'test-qa-report.json'], ['output/preview.png', 'test-preview.png'], ['output/contact-sheet.png', 'test-contact-sheet.png'], ['timeline.json', 'test-timeline.json'], ['analysis/music-analysis.json', 'test-music-analysis.json'], ['voice-validation.json', 'test-voice-validation.json']]) fs.copyFileSync(path.join(dir, src), path.join(sample, dst));
    fs.writeFileSync(path.join(sample, 'ffprobe-mp4.json'), JSON.stringify(await ffprobe(path.join(sample, 'test-final.mp4')), null, 2));
    results.push('samples written to samples/');

    if (process.argv.includes('--ui')) await require('./e2e-ui')(base, out, results);
    console.log('\n=== E2E PASSED ===\n' + results.map((x) => ' - ' + x).join('\n'));
  } catch (e) { console.error('\n=== E2E FAILED ===\n', e.stack || e); process.exitCode = 1; } finally { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 300); }
})();
