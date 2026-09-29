'use strict';
// Brand kit end-to-end (mock assets, Draft): brand colours, multi-weight uploaded font, SVG logo, readable text on the accent colour.
const os = require('os'); const fs = require('fs'); const path = require('path');
process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-brand-')); delete process.env.FAL_KEY;
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const config = require('../server/config');
const { createApp } = require('../server/app');

const FONT_DIR = '/mnt/skills/examples/canvas-design/canvas-fonts';
const fonts = ['BigShoulders-Regular.ttf', 'BigShoulders-Bold.ttf'].map((f) => path.join(FONT_DIR, f));
const skip = !config.findChrome() || !config.findPython() ? 'Chrome/Edge or Python missing' : !fonts.every((f) => fs.existsSync(f)) ? 'test fonts not available' : false;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80"><rect width="300" height="80" rx="12" fill="#fff"/><text x="20" y="55" font-size="44" fill="#DC0028">Credit-IQ</text></svg>';

test('brand kit: colours, weighted font, SVG logo all reach the rendered video', { skip, timeout: 300000 }, async () => {
  const app = createApp(); const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); const base = `http://127.0.0.1:${server.address().port}`; app.get('runner').origin = base;
  try {
    const fd = new FormData();
    fd.append('form', JSON.stringify({ prompt: 'A short calm sentence.', durationSec: 8, format: '16:9', resolution: 720, musicLevel: 0, primaryColor: '#1A1A1A', accentColor: '#DC0028', cta: 'Learn more' }));
    fd.append('logo', new Blob([SVG], { type: 'image/svg+xml' }), 'logo_white.svg');
    for (const f of fonts) fd.append('fonts', new Blob([fs.readFileSync(f)]), path.basename(f));
    const c = await (await fetch(base + '/api/projects', { method: 'POST', body: fd })).json(); assert.ok(c.project, JSON.stringify(c));
    assert.equal(c.concept.brand.primaryColor, '#1A1A1A'); assert.equal(c.concept.brand.accentColor, '#DC0028');
    assert.match(c.concept.brand.fontFamily, /^"BrandFont"/);
    const id = c.project.id;
    const g = await fetch(`${base}/api/projects/${id}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'draft', mock: true }) }); assert.equal(g.status, 200);
    let p; for (;;) { p = (await (await fetch(`${base}/api/projects/${id}`)).json()).project; if (['done', 'done_with_issues', 'failed'].includes(p.status)) break; await new Promise((r) => setTimeout(r, 500)); }
    assert.notEqual(p.status, 'failed', JSON.stringify(p.error));
    const dir = path.join(config.PROJECTS_DIR, id); const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
    assert.deepEqual(tl.assets.fonts.map((f) => f.weight).sort(), [400, 700]); assert.equal(tl.assets.logo, 'assets/logo.svg');
    assert.match(fs.readFileSync(path.join(dir, 'assets', 'logo.svg'), 'utf8'), /<svg width="300" height="80"/);
    const qa = JSON.parse(fs.readFileSync(path.join(dir, 'qa-report.json'), 'utf8'));
    assert.equal(qa.checks.missing_assets.status, 'pass', qa.checks.missing_assets.detail); assert.equal(qa.checks.js_errors.status, 'pass', qa.checks.js_errors.detail);
    // the CTA scene must contain the brand red, and its button text must be white (readable on red)
    const keys = fs.readdirSync(path.join(dir, 'analysis')).filter((f) => /^key-s\d+\.png$/.test(f)).sort(); const last = path.join(dir, 'analysis', keys[keys.length - 1]);
    const py = config.findPython();
    const r = spawnSync(py[0], [...py.slice(1), '-c', `from PIL import Image;import numpy as np;a=np.asarray(Image.open(r'${last}').convert('RGB')).astype(int);d=np.abs(a-[220,0,40]).sum(axis=2);print(int((d<40).sum()), int(((a>235).all(axis=2)).sum()))`], { encoding: 'utf8' });
    const [red, white] = r.stdout.trim().split(' ').map(Number); assert.ok(red > 3000, `brand red pixels: ${red}`); assert.ok(white > 300, `white text pixels: ${white}`);
  } finally { server.close(); }
});
