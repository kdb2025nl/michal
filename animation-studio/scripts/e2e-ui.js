'use strict';
// Browser-driven check of the real UI: create project -> edit storyboard -> Draft render (no Fal key, no paid calls) -> download files.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const puppeteer = require('puppeteer-core');
const config = require('../server/config');

async function uiFlow(base, out, results) {
  let page0 = null;
  const browser = await puppeteer.launch({ executablePath: config.findChrome(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage(); page0 = page; await page.setViewport({ width: 1400, height: 1500 });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|412/.test(m.text())) errs.push(m.text()); });
    await page.goto(base, { waitUntil: 'networkidle0' });
    const chips = await page.$eval('#status-chips', (e) => e.textContent); assert(/FAL_KEY/.test(chips)); assert(!/[0-9a-f]{32}/.test(await page.content()), 'no secrets in HTML');
    await page.select('#format', '9:16'); await page.select('#resolution', '720');
    await page.$eval('#prompt', (e) => { e.value = 'Short explainer for a reporting tool. Sign in -> pick a report -> export the result'; });
    await page.$eval('#durationSec', (e) => { e.value = '14'; }); await page.$eval('#cta', (e) => { e.value = 'Try the demo'; });
    await page.click('#create-btn');
    await page.waitForFunction("!document.getElementById('project').classList.contains('hidden') && document.querySelectorAll('#scenes .scene').length > 0", { timeout: 20000 });
    const nScenes = await page.$$eval('#scenes .scene', (e) => e.length); assert(nScenes >= 3);
    await page.waitForFunction("document.getElementById('preview-tl').textContent.includes('podgląd')", { timeout: 20000 });
    await page.$eval('#scenes [data-f="headline"]', (e) => { e.value = 'Edited headline from the UI'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#save-sb'); await page.waitForFunction("document.getElementById('sb-msg').textContent.startsWith('Zapisano')", { timeout: 10000 });
    assert.equal(await page.$eval('#scenes [data-f="headline"]', (e) => e.value), 'Edited headline from the UI');
    results.push(`UI: storyboard created (${nScenes} scenes), edited and saved`);
    const est = await page.$eval('#estimate', (e) => e.textContent); assert(/Szacowany koszt/.test(est) && /nieznane: whisper/.test(est)); results.push('UI: estimated cost shown before generation, unknown parts flagged');

    await page.click('#gen-final'); await page.waitForFunction("document.getElementById('gen-error').textContent.includes('FAL_KEY')", { timeout: 10000 });
    results.push('UI: Final without FAL_KEY shows a clear error');

    await page.click('#gen-draft');
    await page.waitForFunction("['done','done_with_issues','failed'].includes(document.getElementById('p-status').textContent)", { timeout: 600000, polling: 1000 });
    const status = await page.$eval('#p-status', (e) => e.textContent); assert.notEqual(status, 'failed', await page.$eval('#stage-error', (e) => e.textContent));
    await page.waitForFunction("!document.getElementById('result').classList.contains('hidden') && document.querySelectorAll('#qa table tr').length > 3", { timeout: 20000 });
    const links = await page.$$eval('#downloads a', (a) => a.map((x) => [x.textContent, x.href]));
    for (const need of ['MP4 (Draft)', 'Miniatura PNG', 'Scenariusz', 'Raport QA (JSON)']) assert(links.some((l) => l[0] === need), 'missing download: ' + need);
    const codes = await page.evaluate(async (ls) => Promise.all(ls.map(async (l) => (await fetch(l[1])).status)), links); assert(codes.every((c) => c === 200), 'downloads: ' + codes);
    const vid = await page.$eval('#video', (v) => ({ src: v.src, ready: v.readyState }));
    await page.waitForFunction("document.getElementById('video').readyState >= 1 && document.getElementById('video').videoWidth > 0", { timeout: 20000 });
    const dims = await page.$eval('#video', (v) => [v.videoWidth, v.videoHeight, v.duration]); assert(dims[1] > dims[0], 'portrait video');
    const qaText = await page.$eval('#qa', (e) => e.textContent); assert(/QA:/.test(qaText));
    results.push(`UI: Draft render finished (${status}); video plays in browser ${dims[0]}x${dims[1]} ${dims[2].toFixed(1)}s; downloads OK (${links.map((l) => l[0]).join(', ')})`);
    await page.screenshot({ path: path.join(out, 'ui-project.png'), fullPage: true });
    fs.mkdirSync(path.join(config.ROOT, 'samples'), { recursive: true }); fs.copyFileSync(path.join(out, 'ui-project.png'), path.join(config.ROOT, 'samples', 'ui-screenshot.png'));
    const hist = await page.$$eval('#history li a', (a) => a.length); assert(hist >= 1);
    await page.click('#clean-frames'); await page.waitForFunction("document.getElementById('clean-msg').textContent.includes('usunięte')", { timeout: 10000 }); results.push('UI: intermediate frames removed from the UI');
    assert.deepEqual(errs, [], 'browser errors: ' + errs.join(' | ')); results.push('UI: no JavaScript errors in the browser');
  } catch (e) { if (page0) await page0.screenshot({ path: path.join(out, 'ui-failure.png'), fullPage: true }).catch(() => {}); throw e; } finally { await browser.close(); }
}
module.exports = uiFlow;

if (require.main === module) {
  const os = require('os');
  process.env.PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ui-')); delete process.env.FAL_KEY;
  const { createApp } = require('../server/app');
  const app = createApp(); const server = app.listen(0, '127.0.0.1', async () => {
    const base = `http://127.0.0.1:${server.address().port}`; app.get('runner').origin = base; const results = []; const out = path.join(config.ROOT, 'test-output'); fs.mkdirSync(out, { recursive: true });
    try { await uiFlow(base, out, results); console.log(results.join('\n')); } catch (e) { console.error(e.stack); process.exitCode = 1; } finally { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 200); }
  });
}
