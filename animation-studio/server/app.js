'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const store = require('./store');
const pricing = require('./pricing');
const { buildConcept, getPreset, listPresets, STYLES } = require('./concept');
const { Runner, normaliseDurations, validateStoryboard, estimateFor, previewTimeline, loadConcept, modeFor } = require('./pipeline');
const { validateFacts, validateConcept } = require('./schemas');
const { writeJson, readJson, slug, redact } = require('./util');

const VOICES = ['Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte', 'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill', 'Rachel'];
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp']; const FONT_EXT = ['.ttf', '.otf', '.woff', '.woff2'];

function createApp() {
  const app = express(); const runner = new Runner('');
  app.set('runner', runner);
  app.use(express.json({ limit: '2mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 30 } });
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: redact(e.message || String(e)) }));
  const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

  app.use('/engine', express.static(path.join(config.ROOT, 'src', 'engine')));
  app.use('/projects', (req, res, next) => { if (/project\.json$/i.test(req.path)) return res.status(404).end(); next(); }, express.static(config.PROJECTS_DIR, { dotfiles: 'deny', etag: false, cacheControl: false }));
  app.use(express.static(path.join(config.ROOT, 'src', 'ui')));

  app.get('/api/config', (req, res) => {
    const py = config.findPython();
    res.json({
      falKeyPresent: config.hasFalKey(), // never the value
      limits: { maxSpendUsd: config.MAX_SPEND_USD, maxRetries: config.MAX_RETRIES, maxRenderAttempts: config.MAX_RENDER_ATTEMPTS },
      tools: { chrome: !!config.findChrome(), python: !!py, ffmpeg: true },
      models: config.FAL_MODELS, voices: VOICES, styles: Object.keys(STYLES), pricingVerifiedOn: pricing.table().verifiedOn,
      activeProject: runner.active,
    });
  });
  app.get('/api/presets', (req, res) => res.json(listPresets()));
  app.get('/api/projects', (req, res) => res.json(store.list()));

  app.post('/api/projects', upload.fields([{ name: 'screenshots', maxCount: 12 }, { name: 'logo', maxCount: 1 }, { name: 'fonts', maxCount: 4 }, { name: 'facts', maxCount: 1 }]), wrap(async (req, res) => {
    const form = JSON.parse(req.body.form || '{}');
    const preset = form.presetId ? getPreset(form.presetId) : null; if (form.presetId && !preset) throw bad('unknown preset');
    const merged = preset ? { ...preset.form, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '' && v != null)) } : form;
    if (!preset && !String(merged.prompt || '').trim()) throw bad('Describe the animation first (prompt is empty).');
    if (merged.durationSec !== undefined && !(Number(merged.durationSec) >= 8 && Number(merged.durationSec) <= 180)) throw bad('duration must be 8-180 s');
    const settings = { maxSpendUsd: Number(merged.maxSpendUsd) || config.MAX_SPEND_USD, maxRetries: config.MAX_RETRIES, maxRenderAttempts: config.MAX_RENDER_ATTEMPTS, imageQuality: ['low', 'medium', 'high'].includes(merged.imageQuality) ? merged.imageQuality : 'medium' };
    const p = store.create({ title: merged.title || preset?.name || String(merged.prompt).slice(0, 50), presetId: preset?.id, form: merged, settings });
    const dir = store.dirOf(p.id); const files = req.files || {}; const slots = JSON.parse(req.body.slots || '[]');
    const saveUp = (f, exts, sub = '') => { const ext = path.extname(f.originalname).toLowerCase(); if (!exts.includes(ext)) throw bad(`unsupported file type ${ext} (${f.originalname})`); const name = slug(path.parse(f.originalname).name) + ext; fs.writeFileSync(path.join(dir, 'uploads', name), f.buffer); return name; };
    const screenshots = {};
    (files.screenshots || []).forEach((f, i) => { const name = saveUp(f, IMG_EXT); screenshots[slots[i] || name] = name; });
    p.uploads.screenshots = screenshots;
    if (files.logo?.[0]) p.uploads.logo = saveUp(files.logo[0], IMG_EXT);
    for (const f of files.fonts || []) { const name = saveUp(f, FONT_EXT); p.uploads.fonts.push({ file: name, family: 'UF-' + slug(path.parse(name).name) }); }
    let facts = null;
    if (files.facts?.[0]) {
      try { facts = JSON.parse(files.facts[0].buffer.toString('utf8')); } catch (e) { throw bad('product-facts.json is not valid JSON'); }
      const v = validateFacts(facts); if (!v.ok) throw bad('product-facts.json invalid: ' + v.errors.join('; '));
      fs.writeFileSync(path.join(dir, 'uploads', 'product-facts.json'), JSON.stringify(facts, null, 2)); p.uploads.facts = 'product-facts.json';
    }
    const concept = normaliseDurations(buildConcept(merged, { preset, facts, screenshots, logo: p.uploads.logo, fonts: p.uploads.fonts }));
    writeJson(path.join(dir, 'concept.json'), concept);
    store.log(p, 'project created'); store.save(p);
    res.json(await describe(p.id));
  }));

  async function describe(id) {
    const p = store.load(id); const dir = store.dirOf(id); const concept = loadConcept(dir);
    const validation = validateStoryboard(concept); const est = estimateFor(p, concept);
    const out = (f) => fs.existsSync(path.join(dir, f)) ? f : null;
    return {
      project: p, concept, validation, estimate: est, running: runner.active === id,
      outputs: { mp4: out('output/final.mp4'), webm: out('output/final.webm'), draftMp4: out('output/draft.mp4'), draftWebm: out('output/draft.webm'), preview: out('output/preview.png'), contact: out('output/contact-sheet.png'), qa: out('qa-report.json'), script: out('script.txt'), srt: out('output/captions.srt'), voiceValidation: out('voice-validation.json'), framesPresent: fs.existsSync(path.join(dir, 'frames')) && fs.readdirSync(path.join(dir, 'frames')).length > 0 },
      needsUi: !!(p.presetId && concept.requiresProductUI && !concept.scenes.some((s) => s.type === 'product')),
      resolution: pricing.dimsFor(concept.format, modeFor(p).short),
    };
  }
  app.get('/api/projects/:id', wrap(async (req, res) => res.json(await describe(req.params.id))));
  app.get('/api/projects/:id/preview-timeline', wrap(async (req, res) => res.json(previewTimeline(store.load(req.params.id)))));

  app.put('/api/projects/:id/storyboard', wrap(async (req, res) => {
    const p = store.load(req.params.id); if (runner.active === p.id) throw bad('project is running', 409);
    const concept = req.body; const shape = validateConcept(concept); if (!shape.ok) throw bad('Storyboard JSON invalid: ' + shape.errors.join('; '));
    normaliseDurations(concept); writeJson(path.join(store.dirOf(p.id), 'concept.json'), concept);
    p.stages.storyboard.status = 'pending'; p.status = 'draft'; store.log(p, 'storyboard edited'); store.save(p);
    res.json(await describe(p.id));
  }));
  app.put('/api/projects/:id/settings', wrap(async (req, res) => {
    const p = store.load(req.params.id); const b = req.body; const s = p.settings;
    if (b.maxSpendUsd !== undefined) s.maxSpendUsd = Math.max(0, Number(b.maxSpendUsd));
    if (b.maxRetries !== undefined) s.maxRetries = Math.min(5, Math.max(0, Math.round(Number(b.maxRetries))));
    if (b.maxRenderAttempts !== undefined) s.maxRenderAttempts = Math.min(5, Math.max(1, Math.round(Number(b.maxRenderAttempts))));
    if (['low', 'medium', 'high'].includes(b.imageQuality)) s.imageQuality = b.imageQuality;
    store.save(p); res.json(await describe(p.id));
  }));

  app.post('/api/projects/:id/generate', wrap(async (req, res) => {
    const p = store.load(req.params.id); const b = req.body || {}; const dir = store.dirOf(p.id); const concept = loadConcept(dir);
    const mode = b.mode === 'draft' ? 'draft' : 'final'; const mock = !!b.mock;
    const val = validateStoryboard(concept); if (!val.ok) throw bad('Fix the storyboard first: ' + [...val.errors, ...val.claims.map((c) => c.message)].join('; '), 422);
    const paid = mode === 'final' && !mock;
    if (paid && !config.hasFalKey()) throw bad('FAL_KEY is not set on the server. Add it to .env and restart, or use Mock (local test assets).', 412);
    const est = estimateFor(p, concept);
    if (paid) {
      if (est.knownUsd > p.settings.maxSpendUsd - (p.ledger.spentUsd || 0) + 1e-9) throw bad(`Estimated cost $${est.knownUsd.toFixed(3)} exceeds the remaining spend limit ($${Math.max(0, p.settings.maxSpendUsd - p.ledger.spentUsd).toFixed(2)}). Raise the limit in settings.`, 409);
      if (est.knownUsd > 0 && !b.confirmSpend) throw bad('Confirm the estimated cost first.', 428);
    }
    const noUi = p.presetId && concept.requiresProductUI && !concept.scenes.some((s) => s.type === 'product');
    if (noUi && !b.confirmNoUi) throw bad('This preset needs real UI screenshots. Confirm that you want a concept-only film without product UI.', 428);
    if (p.mock !== mock && Object.keys(p.outputs).length) { /* switching mock<->real: cached hashes differ, so paid assets are only reused when identical */ }
    runner.enqueue(p.id, { mode, mock, retryStage: b.retryStage });
    res.json({ queued: true });
  }));
  app.post('/api/projects/:id/retry', wrap(async (req, res) => {
    const p = store.load(req.params.id); const stage = req.body.stage; if (!store.STAGES.includes(stage)) throw bad('unknown stage');
    if (p.status === 'running') throw bad('already running', 409);
    if (req.body.confirmSpend !== true && !p.mock && ['images', 'music', 'voice', 'whisper'].includes(stage) && p.mode === 'final') {
      const est = estimateFor(p, loadConcept(store.dirOf(p.id))); if (est.knownUsd > 0) throw bad(`Retrying will spend about $${est.knownUsd.toFixed(3)} (already-paid results are reused). Confirm.`, 428);
    }
    runner.enqueue(p.id, { retryStage: stage }); res.json({ queued: true });
  }));
  app.post('/api/projects/:id/cleanup-frames', wrap(async (req, res) => {
    const p = store.load(req.params.id); const dir = store.dirOf(p.id);
    if (!fs.existsSync(path.join(dir, 'output', 'final.mp4')) && !fs.existsSync(path.join(dir, 'output', 'draft.mp4'))) throw bad('No exported video yet; frames are kept until export succeeds.', 409);
    if (runner.active === p.id) throw bad('running', 409);
    fs.rmSync(path.join(dir, 'frames'), { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'frames')); store.log(p, 'frames deleted'); store.save(p); res.json({ ok: true });
  }));
  app.delete('/api/projects/:id', wrap(async (req, res) => {
    const p = store.load(req.params.id); if (runner.active === p.id) throw bad('running', 409); fs.rmSync(store.dirOf(p.id), { recursive: true, force: true }); res.json({ ok: true });
  }));

  const DL = { mp4: 'output/final.mp4', webm: 'output/final.webm', 'draft-mp4': 'output/draft.mp4', 'draft-webm': 'output/draft.webm', png: 'output/preview.png', contact: 'output/contact-sheet.png', script: 'script.txt', srt: 'output/captions.srt', qa: 'qa-report.json', voice: 'voice-validation.json', concept: 'concept.json', timeline: 'timeline.json' };
  app.get('/api/projects/:id/download/:kind', wrap(async (req, res) => {
    const rel = DL[req.params.kind]; if (!rel) throw bad('unknown file'); const p = store.load(req.params.id); const f = path.join(store.dirOf(p.id), rel);
    if (!fs.existsSync(f)) throw bad('file not available yet', 404);
    const names = { png: 'thumbnail.png', script: 'script.txt' }; res.download(f, names[req.params.kind] || path.basename(f));
  }));
  return app;
}
module.exports = { createApp };
