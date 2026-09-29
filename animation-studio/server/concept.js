'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readJson } = require('./util');

const STYLES = {
  'professional-b2b': { palette: ['#0B2545', '#13A89E'], bg: 'clean abstract corporate background, soft geometric shapes, subtle gradients, restrained, professional B2B', music: 'calm modern corporate underscore, subtle pulse, light synth pads, soft percussion, uplifting but restrained' },
  'friendly-saas': { palette: ['#2B3A67', '#F2A541'], bg: 'friendly modern SaaS background, soft rounded shapes, gentle gradients', music: 'light upbeat acoustic-electronic pop instrumental, warm, positive' },
  'bold-launch': { palette: ['#111827', '#EF4444'], bg: 'bold high-contrast abstract background, sharp geometric forms, dramatic lighting', music: 'energetic modern electronic instrumental, driving beat, confident' },
  'minimal-light': { palette: ['#1F2937', '#3B82F6'], bg: 'minimal light background, pale neutral tones, very subtle shapes, lots of empty space', music: 'minimal ambient instrumental, soft piano and pads, gentle rhythm' },
};

const listPresets = () => fs.readdirSync(path.join(config.ROOT, 'presets')).filter((f) => f.endsWith('.json') && f !== 'pricing.json').map((f) => readJson(path.join(config.ROOT, 'presets', f)));
const getPreset = (id) => listPresets().find((p) => p.id === id) || null;

// Claims linting: numbers/percentages/superlatives/integration/trial claims must come from approved facts.
const CLAIM_RE = /\d+\s?%|\b\d+\s?x\b|\b(faster|quicker|free\s+(trial|plan|tier)|integrat\w+|saves?|reduces?|increases?|guarantee\w*|ROI|no\.\s?1|best[- ]in[- ]class|#1)\b|[$€£]\s?\d|\d\s?(USD|EUR|GBP|PLN)\b/i;
function lintClaims(concept) {
  const approved = (concept.approvedClaims || []).map((c) => c.text.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const errors = [];
  for (const s of concept.scenes) {
    for (const field of ['headline', 'subline', 'voiceover', 'caption']) {
      let text = s[field];
      if (!text) continue;
      for (const a of approved) text = text.split(a).join(' ');
      const m = text.match(CLAIM_RE);
      if (m) errors.push({ scene: s.id, field, match: m[0], message: `"${m[0]}" looks like a product claim/result that is not in approved product-facts.json` });
    }
  }
  for (const f of ['text']) { const m = (concept.cta[f] || '').match(CLAIM_RE); if (m) errors.push({ scene: 'cta', field: f, match: m[0], message: `CTA contains unapproved claim "${m[0]}"` }); }
  return errors;
}

const trimSentence = (s, max) => (s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function splitSteps(prompt) {
  const body = prompt.replace(/^.*?(story|steps?|flow)\s*:\s*/is, '');
  let parts = body.split(/\s*(?:->|→|=>|;|\n|•|•)\s*/).map((s) => s.trim().replace(/^[-*\d.)\s]+/, '')).filter(Boolean);
  if (parts.length < 2) parts = prompt.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts;
}

// A font already installed on the machine that renders (e.g. "Times New Roman"). Sanitised: letters, digits, space, dash only.
function systemFontStack(name) {
  const n = String(name || '').replace(/[^\p{L}\p{N} \-]/gu, '').trim().slice(0, 40);
  if (!n) return null;
  const serif = /times|georgia|garamond|palatino|baskerville|serif/i.test(n) && !/sans/i.test(n);
  return `"${n}", ${serif ? 'serif' : 'Helvetica, Arial, sans-serif'}`;
}

const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '').trim()) ? String(v).trim() : null);

function buildConcept(form, opts = {}) {
  const { preset = null, facts = null, screenshots = {}, logo = null, fonts = [] } = opts;
  const style = STYLES[form.style] || STYLES['professional-b2b'];
  const brand = {
    name: form.brandName || preset?.brand?.name || 'Brand',
    primaryColor: hex(form.primaryColor) || preset?.brand?.primaryColor || style.palette[0],
    accentColor: hex(form.accentColor) || preset?.brand?.accentColor || style.palette[1],
    textColor: '#FFFFFF',
    logo,
    fontFamily: (fonts[0] && `"${fonts[0].family}", Helvetica, Arial, sans-serif`) || systemFontStack(form.fontFamily) || 'Segoe UI, Inter, Helvetica, Arial, sans-serif',
  };
  const durationSec = Number(form.durationSec) || 40;
  const claims = (facts?.approvedClaims || []).map((c) => ({ id: c.id, text: c.text }));
  const ctaText = form.cta || facts?.cta?.text || preset?.form?.cta || 'Learn more';
  const ctaUrl = facts?.cta?.url || form.ctaUrl || '';
  const warnings = [];

  const artNote = 'No text, no letters, no logos, no user interface, no screens, no people.';
  const palNote = `Palette: deep ${brand.primaryColor} with accent ${brand.accentColor}.`;
  const images = [
    { id: 'bg-main', purpose: 'background', prompt: `${style.bg}. ${palNote} ${artNote} Wide composition with empty central area for overlay text.` },
    { id: 'bg-alt', purpose: 'background', prompt: `${style.bg}, variation with different composition, same palette and style. ${palNote} ${artNote}` },
    { id: 'bg-cta', purpose: 'background', prompt: `${style.bg}, closing scene, calm and open composition. ${palNote} ${artNote}` },
  ];

  let scenes = [];
  let requiresProductUI = false;
  if (preset) {
    requiresProductUI = !!preset.requiresProductUI;
    const have = (slot) => !!(screenshots[slot]);
    const anyMissing = preset.scenes.some((s) => s.type === 'product' && !have(s.productSlot));
    if (anyMissing) {
      warnings.push('This preset requires real UI screenshots. Missing slots were replaced with a non-product concept plate (no interface is shown). Upload screenshots for every step to get the full product story.');
      let plated = false; const steps = [];
      for (const s of preset.scenes) {
        if (s.type === 'product' && !have(s.productSlot)) {
          steps.push(s);
          if (!plated) { scenes.push({ type: 'concept', headline: preset.conceptFallback.headline, subline: preset.conceptFallback.subline, voiceover: '', plannedDuration: 0, _marker: true }); plated = true; }
        } else scenes.push({ ...s });
      }
      const plate = scenes.find((s) => s._marker); delete plate._marker;
      plate.voiceover = steps.map((s) => s.voiceover).join(' ');
      plate.plannedDuration = Math.max(8, steps.reduce((n, s) => n + s.plannedDuration, 0) * 0.7);
      scenes = scenes.filter((s) => !(s.type === 'product' && !have(s.productSlot)));
    } else scenes = preset.scenes.map((s) => ({ ...s }));
  } else {
    const steps = splitSteps(form.prompt || '');
    const title = form.title || trimSentence(steps[0] || 'Untitled', 60);
    const body = steps.length > 1 ? steps.slice(1) : steps;
    const maxBody = Math.max(1, Math.min(6, Math.round(durationSec / 7) - 2));
    const chosen = body.slice(0, maxBody);
    scenes.push({ type: 'hook', headline: trimSentence(cap(steps[0] || title), 70), voiceover: trimSentence(cap(steps[0] || title), 140), plannedDuration: 5 });
    for (const st of chosen) {
      const slot = null;
      scenes.push({ type: 'concept', headline: trimSentence(cap(st), 60), voiceover: cap(st.replace(/[.!?]+$/, '')) + '.', plannedDuration: 6, productSlot: slot });
    }
    for (const c of claims.slice(0, 2)) scenes.push({ type: 'concept', headline: c.text, voiceover: c.text, plannedDuration: 5 });
    scenes.push({ type: 'cta', headline: ctaText, voiceover: ctaText.replace(/[.!?]*$/, '') + '.', plannedDuration: 5 });
    // Attach screenshots to concept scenes in order when the user provided some without a preset.
    const shotList = Object.values(screenshots);
    let k = 0;
    for (const s of scenes) if (s.type === 'concept' && shotList[k] && !claims.some((c) => c.text === s.headline)) { s.type = 'product'; s.screenshot = shotList[k++]; }
    if (steps.length < 2) warnings.push('Prompt has a single sentence, so the storyboard is short. Add steps separated by "->" or new lines for more scenes.');
  }

  // normalise + ids + background assignment + planned durations weight to target
  const total = scenes.reduce((n, s) => n + s.plannedDuration, 0) || 1;
  scenes = scenes.map((s, i) => {
    const bg = s.type === 'cta' ? 'bg-cta' : (i % 2 ? 'bg-alt' : 'bg-main');
    const slot = s.productSlot || null;
    const shot = s.type === 'product' ? (screenshots[slot] || s.screenshot || null) : null;
    return {
      id: `s${i + 1}`, type: s.type, headline: s.headline, subline: s.subline || '',
      voiceover: s.voiceover, caption: '', productSlot: slot, screenshot: shot, focus: s.focus || null, bg,
      plannedDuration: Math.round((s.plannedDuration / total) * durationSec * 10) / 10,
    };
  });
  for (const s of scenes) if (s.type === 'product' && !s.screenshot) { s.type = 'concept'; warnings.push(`Scene ${s.id} had no screenshot and became a concept plate.`); }

  if (!facts) warnings.push('No product-facts.json provided: neutral language only; numbers, results, integrations and trial claims are blocked.');
  if (form.language && form.prompt && form.language !== 'en' && !preset) warnings.push('Voice-over text is taken from your prompt as written (no automatic translation). Review the script for the chosen language.');

  const concept = {
    version: 1,
    title: form.title || preset?.name || trimSentence(scenes[0]?.headline || 'Untitled', 50),
    audience: form.audience || 'Business decision makers and their teams',
    goal: form.goal || 'Explain the story clearly and drive the viewer to the call to action',
    mainMessage: scenes[0]?.headline || '',
    style: form.style || 'professional-b2b',
    language: form.language || 'en',
    durationSec,
    format: form.format || '16:9',
    musicLevel: form.musicLevel === undefined ? 0.25 : Number(form.musicLevel),
    musicPrompt: `${style.music}. Instrumental only, no vocals, steady tempo around 100-115 BPM.`,
    requiresProductUI,
    brand,
    cta: { text: ctaText, url: ctaUrl },
    voice: { voice: form.voice || 'Aria', pronunciations: form.pronunciations || {} },
    approvedClaims: claims,
    assets: { images },
    scenes,
    warnings,
  };
  return concept;
}

module.exports = { systemFontStack, buildConcept, lintClaims, listPresets, getPreset, STYLES };
