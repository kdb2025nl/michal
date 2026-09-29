'use strict';
// Generates real frames with the engine in headless Chrome and encodes a short MP4 (local mock assets, no paid calls).
const os = require('os'); const fs = require('fs'); const path = require('path');
process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-frames-')); delete process.env.FAL_KEY;
const test = require('node:test');
const assert = require('node:assert');
const config = require('../server/config');
const { createApp } = require('../server/app');
const { ffprobe } = require('../server/util');

const skip = !config.findChrome() || !config.findPython() ? 'Chrome/Edge or Python missing' : false;

test('frame generation: N frames, deterministic renderFrame, playable MP4', { skip, timeout: 240000 }, async () => {
  const app = createApp(); const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`; app.get('runner').origin = base;
  try {
    const fd = new FormData(); fd.append('form', JSON.stringify({ prompt: 'A single calm sentence about the product.', durationSec: 8, format: '1:1', resolution: 720, cta: 'Get started', musicLevel: 0.2 }));
    const c = await (await fetch(base + '/api/projects', { method: 'POST', body: fd })).json(); const id = c.project.id;
    const g = await fetch(`${base}/api/projects/${id}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'draft', mock: true }) }); assert.equal(g.status, 200);
    let p; for (;;) { p = (await (await fetch(`${base}/api/projects/${id}`)).json()).project; if (['done', 'done_with_issues', 'failed'].includes(p.status)) break; await new Promise((r) => setTimeout(r, 500)); }
    assert.notEqual(p.status, 'failed', JSON.stringify(p.error));
    const dir = path.join(config.PROJECTS_DIR, id); const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
    const frames = fs.readdirSync(path.join(dir, 'frames')); assert.equal(frames.length, Math.round(tl.duration * tl.fps));
    assert.ok(frames.every((f) => fs.statSync(path.join(dir, 'frames', f)).size > 1000));
    assert.equal(tl.width, tl.height); assert.equal(tl.width, 480);
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'analysis', 'determinism.json'), 'utf8')).ok);
    const pr = await ffprobe(path.join(dir, 'output', 'draft.mp4')); assert.ok(Math.abs(Number(pr.format.duration) - tl.duration) < 0.3);
    const qa = JSON.parse(fs.readFileSync(path.join(dir, 'qa-report.json'), 'utf8')); assert.equal(qa.checks.ffprobe_mp4.status, 'pass'); assert.equal(qa.overall, 'pass', qa.failedChecks.join(','));
  } finally { server.close(); }
});
