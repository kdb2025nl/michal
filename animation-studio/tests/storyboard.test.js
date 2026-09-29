'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildConcept, getPreset, lintClaims } = require('../server/concept');
const { validateStoryboard, normaliseDurations } = require('../server/pipeline');
const { validateConcept, validateFacts } = require('../server/schemas');

const shots = { 'overdue-invoices': 'a.png', prioritization: 'b.png', workflow: 'c.png', tasks: 'd.png', status: 'e.png' };

test('generic prompt -> valid concept ending in CTA', () => {
  const c = normaliseDurations(buildConcept({ prompt: 'Explain our tool. Sign in -> pick a report -> export', durationSec: 30, format: '9:16', cta: 'Try it' }));
  assert.ok(validateConcept(c).ok, JSON.stringify(validateConcept(c).errors));
  assert.equal(c.scenes.at(-1).type, 'cta');
  assert.ok(validateStoryboard(c).ok);
  assert.ok(Math.abs(c.scenes.reduce((n, s) => n + s.plannedDuration, 0) - 30) < 0.05);
});

test('Credit-IQ preset with screenshots -> 5 product scenes, valid', () => {
  const p = getPreset('credit-iq'); const c = normaliseDurations(buildConcept(p.form, { preset: p, screenshots: shots }));
  assert.equal(c.scenes.filter((s) => s.type === 'product').length, 5);
  assert.ok(c.durationSec >= 35 && c.durationSec <= 45);
  assert.ok(validateStoryboard(c).ok);
});

test('Credit-IQ preset without screenshots never invents UI: concept plate only', () => {
  const p = getPreset('credit-iq'); const c = normaliseDurations(buildConcept(p.form, { preset: p, screenshots: {} }));
  assert.equal(c.scenes.filter((s) => s.type === 'product').length, 0);
  assert.ok(c.warnings.some((w) => /screenshots/i.test(w)));
  assert.ok(validateStoryboard(c).ok);
  for (const im of c.assets.images) assert.match(im.prompt, /no user interface/i);
});

test('unapproved numeric / integration / trial claims are blocked', () => {
  const c = normaliseDurations(buildConcept({ prompt: 'Intro. Get results 30% faster -> Integrates with SAP -> Free trial for 14 days', durationSec: 30 }));
  const r = validateStoryboard(c); assert.equal(r.ok, false); assert.ok(r.claims.length >= 3, JSON.stringify(r.claims));
});

test('the same claim passes when it is in approved facts', () => {
  const facts = { approvedClaims: [{ id: 'c1', text: 'Reduces manual follow-up work by 30%' }] };
  assert.ok(validateFacts(facts).ok);
  const c = normaliseDurations(buildConcept({ prompt: 'Intro. Step one -> Step two', durationSec: 30 }, { facts }));
  assert.ok(c.scenes.some((s) => s.headline === facts.approvedClaims[0].text));
  assert.deepEqual(lintClaims(c), []);
});

test('storyboard validation catches broken structure', () => {
  const c = normaliseDurations(buildConcept({ prompt: 'Intro. Step one', durationSec: 30 }));
  const a = JSON.parse(JSON.stringify(c)); a.scenes.pop(); assert.equal(validateStoryboard(a).ok, false, 'last scene must be CTA');
  const b = JSON.parse(JSON.stringify(c)); b.scenes[0].bg = 'nope'; assert.equal(validateStoryboard(b).ok, false);
  const d = JSON.parse(JSON.stringify(c)); d.scenes[0].plannedDuration += 10; assert.equal(validateStoryboard(d).ok, false, 'durations must sum to target');
  const e = JSON.parse(JSON.stringify(c)); e.scenes[1].type = 'product'; e.scenes[1].screenshot = null; assert.equal(validateStoryboard(e).ok, false, 'product scene needs screenshot');
});

test('normaliseDurations makes scene sum equal the target', () => {
  const c = buildConcept({ prompt: 'Intro. A -> B -> C', durationSec: 37 }); c.scenes[0].plannedDuration = 11; normaliseDurations(c);
  assert.ok(Math.abs(c.scenes.reduce((n, s) => n + s.plannedDuration, 0) - 37) < 0.05);
});
