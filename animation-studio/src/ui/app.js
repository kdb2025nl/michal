'use strict';
const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
const STAGES = { storyboard: 'Storyboard', images: 'Obrazy', music: 'Muzyka', voice: 'Lektor', whisper: 'Kontrola Whisper', analysis: 'Analiza audio', animation: 'Animacja', render: 'Render', qa: 'QA' };
let cfg = null; let presets = []; let current = null; let data = null; let pollTimer = null; let engine = null; let editing = false;

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body; else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
  const r = await fetch(url, opt); const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; } return j;
}
const usd = (x) => (x == null ? 'nieznany' : '$' + x.toFixed(x < 0.1 ? 4 : 3));

async function init() {
  cfg = await api('GET', '/api/config'); presets = await api('GET', '/api/presets');
  const chips = $('status-chips');
  const chip = (t, ok) => chips.append(h('span', { class: 'chip ' + (ok ? 'ok' : 'bad') }, (ok ? '● ' : '○ ') + t));
  chip(cfg.falKeyPresent ? 'FAL_KEY ustawiony (na serwerze)' : 'brak FAL_KEY — dostępny tylko Mock/Draft', cfg.falKeyPresent);
  if (!cfg.falKeyPresent) {
    const kf = $('key-form'); kf.classList.remove('hidden');
    kf.addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('POST', '/api/config/fal-key', { key: $('key-input').value }); $('key-input').value = ''; location.reload(); } catch (e) { $('key-msg').textContent = e.message; } });
  }
  chip('Chrome/Edge', cfg.tools.chrome); chip('Python', cfg.tools.python);
  for (const v of cfg.voices) $('voice').append(h('option', { value: v }, v));
  for (const s of cfg.styles) $('style').append(h('option', { value: s }, s));
  $('maxSpendUsd').value = cfg.limits.maxSpendUsd;
  for (const p of presets) $('preset').append(h('option', { value: p.id }, p.name));
  $('preset').addEventListener('change', onPreset); $('screenshots').addEventListener('change', renderConsent); ['logo', 'fonts', 'facts'].forEach((i) => $(i).addEventListener('change', renderConsent));
  $('musicLevel').addEventListener('input', () => { $('musicOut').textContent = $('musicLevel').value + '%'; });
  $('form').addEventListener('submit', onCreate);
  renderConsent(); await refreshHistory();
  const hash = location.hash.replace('#', ''); if (hash) openProject(hash);
}

function onPreset() {
  const p = presets.find((x) => x.id === $('preset').value); $('preset-help').textContent = p ? p.description : '';
  if (p) { const f = p.form; $('prompt').value = f.prompt; $('language').value = f.language; $('durationSec').value = f.durationSec; $('format').value = f.format; $('resolution').value = f.resolution; $('style').value = f.style; $('cta').value = f.cta; $('musicLevel').value = Math.round(f.musicLevel * 100); $('musicOut').textContent = $('musicLevel').value + '%'; $('voice').value = f.voice; }
  renderSlots();
}
function renderSlots() {
  const box = $('shot-slots'); box.replaceChildren(); const files = [...$('screenshots').files]; const p = presets.find((x) => x.id === $('preset').value);
  if (!files.length) return;
  box.append(h('p', { class: 'hint' }, p ? 'Przypisz każdy zrzut do kroku presetu:' : 'Zrzuty zostaną użyte po kolei w scenach produktowych.'));
  files.forEach((f, i) => {
    if (!p) return;
    const sel = h('select', { 'data-slot': i }, h('option', { value: '' }, '— nieprzypisany —'), p.slots.map((s) => h('option', { value: s.id, selected: p.slots[i] && p.slots[i].id === s.id }, s.label)));
    box.append(h('label', {}, f.name, sel));
  });
}
function renderConsent() {
  renderSlots(); const files = ['screenshots', 'logo', 'fonts', 'facts'].flatMap((id) => [...$(id).files].map((f) => f.name));
  $('consent').replaceChildren(h('strong', {}, 'Prywatność plików. '), 'Wybrane pliki (' + (files.length ? files.join(', ') : 'brak') + ') pozostają na tym komputerze i są używane wyłącznie lokalnie w animacji. ', h('strong', {}, 'Do Fal nie zostanie wysłany żaden z nich. '), 'Do Fal trafia tylko tekst poleceń wygenerowanych z Twojego opisu (prompty obrazów i muzyki, tekst lektora) oraz wygenerowany lektor do kontroli Whisper. Wysyłka jakiegokolwiek pliku użytkownika wymagałaby osobnej, jawnej zgody.');
}

async function onCreate(ev) {
  ev.preventDefault(); $('create-error').textContent = ''; $('create-btn').disabled = true;
  try {
    const pron = {}; for (const l of $('pron').value.split('\n')) { const m = l.match(/^\s*(.+?)\s*=\s*(.+?)\s*$/); if (m) pron[m[1]] = m[2]; }
    const form = { presetId: $('preset').value || undefined, prompt: $('prompt').value, language: $('language').value, voice: $('voice').value, durationSec: Number($('durationSec').value), format: $('format').value, resolution: Number($('resolution').value), style: $('style').value, cta: $('cta').value || undefined, ctaUrl: $('ctaUrl').value || undefined, musicLevel: Number($('musicLevel').value) / 100, imageQuality: $('imageQuality').value, maxSpendUsd: Number($('maxSpendUsd').value), brandName: $('brandName').value || undefined, pronunciations: pron };
    const fd = new FormData(); fd.append('form', JSON.stringify(form));
    const slots = []; const files = [...$('screenshots').files];
    files.forEach((f, i) => { fd.append('screenshots', f); const s = document.querySelector(`select[data-slot="${i}"]`); slots.push(s ? s.value : ''); });
    fd.append('slots', JSON.stringify(slots));
    if ($('logo').files[0]) fd.append('logo', $('logo').files[0]);
    for (const f of $('fonts').files) fd.append('fonts', f);
    if ($('facts').files[0]) fd.append('facts', $('facts').files[0]);
    const res = await api('POST', '/api/projects', fd); await refreshHistory(); openProject(res.project.id);
  } catch (e) { $('create-error').textContent = e.message; } finally { $('create-btn').disabled = false; }
}

async function refreshHistory() {
  const list = await api('GET', '/api/projects'); const ul = $('history'); ul.replaceChildren();
  if (!list.length) ul.append(h('li', {}, h('span', { class: 'hint' }, 'Brak projektów.')));
  for (const p of list) ul.append(h('li', {}, h('span', {}, h('a', { onclick: () => openProject(p.id) }, p.title), ' ', h('span', { class: 'hint' }, `${p.status}${p.hasVideo ? ' · wideo' : ''} · ${usd(p.spentUsd)}`)), h('span', { class: 'hint' }, p.createdAt.slice(0, 16).replace('T', ' '))));
}

async function openProject(id) { current = id; location.hash = id; editing = false; await load(true); $('project').classList.remove('hidden'); $('project').scrollIntoView({ behavior: 'smooth' }); }
async function load(full) {
  data = await api('GET', '/api/projects/' + current); render(full); clearTimeout(pollTimer);
  const active = ['queued', 'running'].includes(data.project.status); pollTimer = setTimeout(() => load(false), active ? 1000 : 6000);
}

function render(full) {
  const { project: p, concept, validation, estimate, outputs } = data;
  $('p-title').textContent = p.title; $('p-id').textContent = p.id; $('p-status').textContent = p.status;
  const busy = ['queued', 'running'].includes(p.status);
  if (full || !editing) renderStoryboard(concept, validation, full);
  renderEstimate(estimate, p, busy); renderStages(p, busy); renderResult(outputs, p);
  $('gen-final').disabled = busy; $('gen-draft').disabled = busy; $('save-sb').disabled = busy;
  const needs = data.needsUi; $('c-noui-wrap').classList.toggle('hidden', !needs);
  $('c-spend-wrap').classList.toggle('hidden', $('c-mock').checked || !(estimate.knownUsd > 0));
}

function renderStoryboard(concept, validation, full) {
  const w = $('warnings'); w.replaceChildren();
  for (const m of concept.warnings || []) w.append(h('div', { class: 'notice warn' }, m));
  for (const m of validation.errors) w.append(h('div', { class: 'notice bad' }, 'Błąd storyboardu: ' + m));
  for (const c of validation.claims) w.append(h('div', { class: 'notice bad' }, `Scena ${c.scene}, pole „${c.field}”: ${c.message}. Popraw tekst albo dostarcz product-facts.json z zatwierdzonym twierdzeniem.`));
  if (data.needsUi) w.append(h('div', { class: 'notice warn' }, 'Ten preset wymaga zrzutów UI produktu. Bez nich powstanie wyłącznie plansza koncepcyjna — interfejs produktu nie jest generowany ani wymyślany.'));
  if (!full && $('scenes').children.length) return;
  const box = $('scenes'); box.replaceChildren();
  const shots = Object.values(data.project.uploads.screenshots);
  concept.scenes.forEach((s, i) => {
    const q = (f) => `[data-i="${i}"][data-f="${f}"]`;
    box.append(h('div', { class: 'scene' },
      h('header', {}, h('span', { class: 'tag' }, `${i + 1} · ${s.type}`), h('span', { class: 'hint' }, s.screenshot ? 'zrzut: ' + s.screenshot : ''), h('button', { type: 'button', onclick: () => { concept.scenes.splice(i, 1); renderScenesFromConcept(concept); } }, 'Usuń scenę')),
      h('label', {}, 'Nagłówek', h('input', { type: 'text', 'data-i': i, 'data-f': 'headline', value: s.headline })),
      h('label', {}, 'Podtytuł (opcjonalnie)', h('input', { type: 'text', 'data-i': i, 'data-f': 'subline', value: s.subline || '' })),
      h('label', {}, 'Tekst lektora (napisy = tekst lektora)', h('textarea', { rows: 2, 'data-i': i, 'data-f': 'voiceover' }, s.voiceover)),
      h('div', { class: 'grid2' }, h('label', {}, 'Planowany czas (s)', h('input', { type: 'number', min: 2, max: 30, step: 0.1, 'data-i': i, 'data-f': 'plannedDuration', value: s.plannedDuration })),
        s.type === 'product' ? h('label', {}, 'Zrzut ekranu', h('select', { 'data-i': i, 'data-f': 'screenshot' }, shots.map((f) => h('option', { value: f, selected: f === s.screenshot }, f)))) : h('span'))));
  });
  box.addEventListener('input', () => { editing = true; });
  $('e-cta').value = concept.cta.text; $('e-music').value = concept.musicPrompt;
  loadPreview();
}
function renderScenesFromConcept(concept) { data.concept = concept; $('scenes').replaceChildren(); renderStoryboard(concept, data.validation, true); editing = true; }
function collectConcept() {
  const c = JSON.parse(JSON.stringify(data.concept));
  document.querySelectorAll('#scenes [data-i]').forEach((el) => { const s = c.scenes[+el.dataset.i]; const f = el.dataset.f; s[f] = f === 'plannedDuration' ? Number(el.value) : el.value; });
  c.cta.text = $('e-cta').value; c.musicPrompt = $('e-music').value; c.mainMessage = c.scenes[0]?.headline || c.mainMessage;
  const last = c.scenes[c.scenes.length - 1]; if (last && last.type === 'cta') { last.headline = last.headline || c.cta.text; }
  return c;
}
$('save-sb').addEventListener('click', async () => {
  $('sb-msg').textContent = 'Zapisuję…';
  try { data = await api('PUT', `/api/projects/${current}/storyboard`, collectConcept()); editing = false; render(true); $('sb-msg').textContent = 'Zapisano. Już wygenerowane płatne assety zostaną użyte ponownie, jeśli ich prompty się nie zmieniły.'; } catch (e) { $('sb-msg').textContent = 'Błąd: ' + e.message; }
});

async function loadPreview() {
  try {
    const tl = await api('GET', `/api/projects/${current}/preview-timeline`); const canvas = $('preview-canvas'); tl.width = Math.round(tl.width / 2) * 2; 
    engine = await AnimationEngine.create({ canvas, timeline: tl, baseUrl: `/projects/${current}/` });
    const slider = $('preview-t'); slider.max = tl.duration; slider.step = 1 / tl.fps; const draw = () => { engine.renderFrame(Number(slider.value)); $('preview-tl').textContent = `${Number(slider.value).toFixed(1)}s / ${tl.duration.toFixed(1)}s · podgląd szacunkowy (brakujące obrazy tła zastąpione gradientem)`; };
    slider.oninput = draw; slider.value = Math.min(tl.duration - 0.1, 1.2); draw();
  } catch (e) { $('preview-tl').textContent = 'Podgląd niedostępny: ' + e.message; }
}

function renderEstimate(est, p, busy) {
  const box = $('estimate'); box.replaceChildren();
  const rows = est.items.map((i) => h('tr', {}, h('td', {}, i.label), h('td', {}, usd(i.usd))));
  box.append(h('table', { class: 'qa' }, rows),
    h('p', {}, h('strong', {}, `Szacowany koszt: ${usd(est.knownUsd)}`), est.unknownParts.length ? ` + nieznane: ${est.unknownParts.join(', ')} (cena nie jest publikowana jako liczba)` : '', ` · limit projektu: ${usd(p.settings.maxSpendUsd)} · wydano dotąd: ${usd(p.ledger.spentUsd)} · ponowienia: max ${p.settings.maxRetries}`),
    h('p', { class: 'hint' }, `Ceny z oficjalnych stron Fal, stan na ${est.verifiedOn}; to oszacowanie. Elementy już wygenerowane (cache) nie są liczone. Dodatkowy zapas na automatyczne ponowienia lektora: do ~${usd(est.retryAllowanceUsd)}.`));
  if (!est.withinLimit) box.append(h('div', { class: 'notice bad' }, 'Szacowany koszt przekracza limit wydatków — zwiększ limit w polu „Limit wydatków” przy tworzeniu projektu albo zmień ustawienia.'));
  const lim = h('div', { class: 'row' }, h('label', {}, 'Limit wydatków (USD) ', h('input', { type: 'number', id: 's-limit', min: 0, step: 0.1, value: p.settings.maxSpendUsd, style: 'width:110px' })), h('label', {}, 'Ponowienia ', h('input', { type: 'number', id: 's-retries', min: 0, max: 5, value: p.settings.maxRetries, style: 'width:70px' })), h('button', { type: 'button', onclick: saveSettings }, 'Zapisz limity'));
  box.append(lim);
}
async function saveSettings() { try { data = await api('PUT', `/api/projects/${current}/settings`, { maxSpendUsd: Number($('s-limit').value), maxRetries: Number($('s-retries').value) }); render(false); } catch (e) { $('gen-error').textContent = e.message; } }

async function generate(mode) {
  $('gen-error').textContent = '';
  try { await api('POST', `/api/projects/${current}/generate`, { mode, mock: $('c-mock').checked, confirmSpend: $('c-spend').checked, confirmNoUi: $('c-noui').checked }); await load(false); }
  catch (e) { $('gen-error').textContent = e.message + (e.status === 428 ? ' (zaznacz odpowiednie potwierdzenie powyżej)' : ''); if (e.status === 428) { $('c-spend-wrap').classList.remove('hidden'); } }
}
$('gen-final').addEventListener('click', () => generate('final'));
$('gen-draft').addEventListener('click', () => generate('draft'));
$('c-mock').addEventListener('change', () => { if (data) render(false); });

function renderStages(p, busy) {
  const ol = $('stages'); ol.replaceChildren(); let err = '';
  for (const [k, label] of Object.entries(STAGES)) {
    const s = p.stages[k]; const cls = 'st-' + s.status;
    ol.append(h('li', {}, h('span', {}, label), h('span', { class: cls }, { pending: 'oczekuje', running: 'trwa…', done: 'gotowe', failed: 'błąd', skipped: 'pominięte' }[s.status] || s.status),
      h('div', {}, s.status === 'running' && s.progress != null ? h('div', { class: 'bar' }, h('i', { style: `width:${s.progress}%` })) : h('span', { class: 'hint' }, s.note || '')),
      s.status === 'failed' ? h('button', { onclick: () => retry(k) }, 'Ponów etap') : h('span')));
    if (s.status === 'failed') err = `Etap „${label}” nie powiódł się:\n${s.error}\n(Wcześniejsze udane, płatne wywołania są zapisane i nie zostaną powtórzone.)`;
  }
  $('stage-error').textContent = err;
}
async function retry(stage) {
  try { await api('POST', `/api/projects/${current}/retry`, { stage, confirmSpend: $('c-spend').checked }); await load(false); }
  catch (e) { $('stage-error').textContent = e.message; if (e.status === 428) $('c-spend-wrap').classList.remove('hidden'); }
}

function renderResult(o, p) {
  const has = o.mp4 || o.draftMp4; $('result').classList.toggle('hidden', !has); if (!has) return;
  const which = o.mp4 || o.webm ? 'final' : 'draft'; const v = $('video'); const key = which + '|' + p.updatedAt;
  if (v.dataset.src !== key) { v.dataset.src = key; const q = '?v=' + Date.now(); v.replaceChildren(h('source', { src: `/projects/${p.id}/output/${which}.mp4${q}`, type: 'video/mp4' }), h('source', { src: `/projects/${p.id}/output/${which}.webm${q}`, type: 'video/webm' })); v.load(); }
  const d = $('downloads'); d.replaceChildren();
  const dl = (kind, label, ok) => ok && d.append(h('a', { href: `/api/projects/${p.id}/download/${kind}`, download: '' }, h('button', { type: 'button' }, label)));
  dl('mp4', 'Pobierz MP4', o.mp4); dl('webm', 'Pobierz WebM', o.webm); dl('draft-mp4', 'MP4 (Draft)', o.draftMp4); dl('png', 'Miniatura PNG', o.preview); dl('script', 'Scenariusz', o.script); dl('srt', 'Napisy SRT', o.srt); dl('qa', 'Raport QA (JSON)', o.qa);
  if (o.contact) $('contact').src = `/projects/${p.id}/output/contact-sheet.png?v=` + encodeURIComponent(p.updatedAt);
  $('clean-frames').disabled = !o.framesPresent;
  if (o.qa) fetch(`/projects/${p.id}/qa-report.json?v=${Date.now()}`).then((r) => r.json()).then(showQa).catch(() => {});
}
function showQa(qa) {
  const box = $('qa'); box.replaceChildren();
  box.append(h('div', { class: 'notice ' + (qa.overall === 'pass' ? '' : 'bad') }, `QA: ${qa.overall.toUpperCase()} — ${qa.summary.pass} ok, ${qa.summary.fail} błędów, ${qa.summary.warn} ostrzeżeń, ${qa.summary.notTested} nie testowano${qa.mock ? ' · MOCK (lokalne assety testowe)' : ''}`));
  box.append(h('table', { class: 'qa' }, Object.entries(qa.checks).map(([k, c]) => h('tr', {}, h('td', {}, k), h('td', {}, h('span', { class: 'pill ' + c.status }, c.status)), h('td', {}, c.detail)))));
  box.append(h('details', {}, h('summary', {}, 'Ograniczenia automatycznej oceny'), h('ul', {}, qa.limitations.map((l) => h('li', {}, l)))));
}
$('clean-frames').addEventListener('click', async () => { try { await api('POST', `/api/projects/${current}/cleanup-frames`); $('clean-msg').textContent = 'Klatki usunięte.'; await load(false); } catch (e) { $('clean-msg').textContent = e.message; } });

init().catch((e) => { document.body.prepend(h('pre', { class: 'error' }, 'Błąd inicjalizacji: ' + e.message)); });
