'use strict';
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: false });

const str = { type: 'string' };
const numRange = (min, max) => ({ type: 'number', minimum: min, maximum: max });

const conceptSchema = {
  type: 'object',
  required: ['version', 'title', 'language', 'durationSec', 'format', 'scenes', 'assets', 'cta', 'voice', 'brand'],
  properties: {
    version: { const: 1 },
    title: { type: 'string', minLength: 1 },
    audience: str, goal: str, mainMessage: str, style: str,
    language: { type: 'string', pattern: '^[a-z]{2}$' },
    durationSec: numRange(5, 180),
    format: { enum: ['16:9', '9:16', '1:1'] },
    musicLevel: numRange(0, 1),
    musicPrompt: str,
    requiresProductUI: { type: 'boolean' },
    brand: {
      type: 'object',
      required: ['name', 'primaryColor', 'accentColor'],
      properties: { name: str, primaryColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, accentColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, textColor: str, logo: { type: ['string', 'null'] }, fontFamily: str },
    },
    cta: { type: 'object', required: ['text'], properties: { text: { type: 'string', minLength: 1 }, url: str } },
    voice: { type: 'object', required: ['voice'], properties: { voice: str, pronunciations: { type: 'object', additionalProperties: str } } },
    approvedClaims: { type: 'array', items: { type: 'object', required: ['id', 'text'], properties: { id: str, text: str } } },
    assets: {
      type: 'object', required: ['images'],
      properties: { images: { type: 'array', items: { type: 'object', required: ['id', 'prompt'], properties: { id: str, purpose: str, prompt: { type: 'string', minLength: 5 } } } } },
    },
    scenes: {
      type: 'array', minItems: 1, maxItems: 14,
      items: {
        type: 'object',
        required: ['id', 'type', 'headline', 'voiceover', 'plannedDuration', 'bg'],
        properties: {
          id: str,
          type: { enum: ['hook', 'concept', 'product', 'cta'] },
          headline: { type: 'string', minLength: 1 }, subline: str, voiceover: str, caption: str,
          productSlot: { type: ['string', 'null'] }, screenshot: { type: ['string', 'null'] },
          focus: { type: ['object', 'null'], properties: { x: numRange(0, 1), y: numRange(0, 1), w: numRange(0.05, 1), h: numRange(0.05, 1) } },
          bg: str, plannedDuration: numRange(2, 30),
        },
      },
    },
  },
};

const timelineSchema = {
  type: 'object',
  required: ['version', 'seed', 'fps', 'width', 'height', 'duration', 'scenes', 'style', 'audio', 'assets'],
  properties: {
    version: { const: 1 }, seed: { type: 'integer' }, fps: numRange(10, 60), width: { type: 'integer', minimum: 64 }, height: { type: 'integer', minimum: 64 },
    duration: numRange(1, 400),
    scenes: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['id', 'type', 'start', 'duration', 'layers'],
        properties: { id: str, type: str, start: { type: 'number', minimum: 0 }, duration: { type: 'number', exclusiveMinimum: 0 }, layers: { type: 'array' }, camera: { type: 'array' }, syncMarkers: { type: 'array' }, transitionIn: { type: 'object' } },
      },
    },
  },
};

const factsSchema = {
  type: 'object',
  properties: {
    product: str,
    approvedClaims: { type: 'array', items: { type: 'object', required: ['id', 'text'], properties: { id: str, text: str } } },
    cta: { type: 'object', properties: { text: str, url: str } },
    notes: str,
  },
};

const compile = (s) => { const v = ajv.compile(s); return (d) => { const ok = v(d); return { ok, errors: ok ? [] : v.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) }; }; };
const validateConcept = compile(conceptSchema);
const validateTimelineShape = compile(timelineSchema);
const validateFacts = compile(factsSchema);

// Semantic timeline checks beyond JSON-schema shape.
function validateTimeline(tl, eps = 0.011) {
  const r = validateTimelineShape(tl);
  const errors = [...r.errors];
  if (r.ok) {
    let t = 0;
    for (const s of tl.scenes) {
      if (Math.abs(s.start - t) > eps) errors.push(`scene ${s.id}: start ${s.start} != expected ${t.toFixed(3)} (gap/overlap)`);
      t = s.start + s.duration;
    }
    if (Math.abs(t - tl.duration) > eps) errors.push(`scene durations sum to ${t.toFixed(3)} but duration is ${tl.duration}`);
    const ids = new Set();
    for (const s of tl.scenes) { if (ids.has(s.id)) errors.push(`duplicate scene id ${s.id}`); ids.add(s.id); }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validateConcept, validateTimeline, validateFacts };
