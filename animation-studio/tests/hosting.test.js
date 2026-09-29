'use strict';
// Hosted-mode safety: password gate, refusal to bind publicly without it, and the headless renderer authenticating against it.
const os = require('os'); const fs = require('fs'); const path = require('path');
process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-host-')); delete process.env.FAL_KEY; process.env.APP_PASSWORD = 's3cret-pass';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const config = require('../server/config');
const { createApp } = require('../server/app');

const auth = { authorization: 'Basic ' + Buffer.from('anyone:' + process.env.APP_PASSWORD).toString('base64') };
const skip = !config.findChrome() || !config.findPython() ? 'Chrome/Edge or Python missing' : false;

test('server refuses a public HOST without APP_PASSWORD', () => {
  const r = spawnSync(process.execPath, [path.join(config.ROOT, 'server', 'index.js')], { env: { ...process.env, APP_PASSWORD: '', HOST: '0.0.0.0', PORT: '0', NO_OPEN: '1' }, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 1); assert.match(r.stderr, /APP_PASSWORD/);
});

test('password gate: 401 without/with wrong password, 200 with it, FAL_KEY never exposed', async () => {
  const app = createApp(); const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/config')).status, 401);
    assert.equal((await fetch(base + '/', { headers: { authorization: 'Basic ' + Buffer.from('a:wrong').toString('base64') } })).status, 401);
    process.env.FAL_KEY = 'fal-secret-should-not-leak';
    const ok = await fetch(base + '/api/config', { headers: auth }); assert.equal(ok.status, 200);
    const body = await ok.text(); assert.ok(!body.includes('fal-secret-should-not-leak')); assert.equal(JSON.parse(body).falKeyPresent, true);
    assert.equal((await fetch(base + '/projects/x/project.json', { headers: auth })).status, 404);
  } finally { delete process.env.FAL_KEY; server.close(); }
});

test('hosted mode: full Draft render works behind the password (renderer authenticates)', { skip, timeout: 240000 }, async () => {
  const app = createApp(); const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); const base = `http://127.0.0.1:${server.address().port}`; app.get('runner').origin = base;
  try {
    const fd = new FormData(); fd.append('form', JSON.stringify({ prompt: 'One calm sentence.', durationSec: 8, format: '16:9', resolution: 720, musicLevel: 0 }));
    const c = await (await fetch(base + '/api/projects', { method: 'POST', body: fd, headers: auth })).json(); const id = c.project.id;
    const g = await fetch(`${base}/api/projects/${id}/generate`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'draft', mock: true }) }); assert.equal(g.status, 200);
    let p; for (;;) { p = (await (await fetch(`${base}/api/projects/${id}`, { headers: auth })).json()).project; if (['done', 'done_with_issues', 'failed'].includes(p.status)) break; await new Promise((r) => setTimeout(r, 500)); }
    assert.equal(p.status, 'done', JSON.stringify(p.error));
    assert.ok(fs.existsSync(path.join(config.PROJECTS_DIR, id, 'output', 'draft.mp4')));
  } finally { server.close(); }
});
