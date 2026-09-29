'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readJson, writeJson, newId, redact } = require('./util');

const STAGES = ['storyboard', 'images', 'music', 'voice', 'whisper', 'analysis', 'animation', 'render', 'qa'];
const STAGE_LABELS = { storyboard: 'Storyboard', images: 'Images', music: 'Music', voice: 'Voice-over', whisper: 'Whisper check', analysis: 'Audio analysis', animation: 'Animation', render: 'Render', qa: 'QA' };

const dirOf = (id) => path.join(config.PROJECTS_DIR, id);
const fileOf = (id) => path.join(dirOf(id), 'project.json');
const validId = (id) => /^[0-9]{14}-[0-9a-f]{6}$/.test(id);

function emptyStages() { return Object.fromEntries(STAGES.map((s) => [s, { status: 'pending', attempts: 0 }])); }

function create({ title, presetId, form, settings }) {
  const id = newId(); const dir = dirOf(id);
  for (const d of ['assets', 'analysis', 'frames', 'output', 'uploads']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const p = {
    id, title: title || 'Untitled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    presetId: presetId || null, form, settings, mode: 'final', mock: false,
    uploads: { screenshots: {}, logo: null, fonts: [], facts: null }, consent: { sendFiles: [] },
    stages: emptyStages(), status: 'draft', ledger: { spentUsd: 0, calls: [] }, log: [], outputs: {},
  };
  save(p); return p;
}
function load(id) { if (!validId(id)) throw Object.assign(new Error('bad project id'), { status: 400 }); const p = readJson(fileOf(id), null); if (!p) throw Object.assign(new Error('project not found'), { status: 404 }); return p; }
function save(p) { p.updatedAt = new Date().toISOString(); writeJson(fileOf(p.id), p); }
function list() {
  if (!fs.existsSync(config.PROJECTS_DIR)) return [];
  return fs.readdirSync(config.PROJECTS_DIR).filter(validId).map((id) => { try { const p = readJson(fileOf(id)); return { id, title: p.title, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, spentUsd: p.ledger?.spentUsd || 0, presetId: p.presetId, hasVideo: fs.existsSync(path.join(dirOf(id), 'output', 'final.mp4')) || fs.existsSync(path.join(dirOf(id), 'output', 'draft.mp4')) }; } catch (e) { return null; } }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function log(p, msg) { p.log.push({ t: new Date().toISOString(), msg: redact(msg) }); if (p.log.length > 300) p.log.splice(0, p.log.length - 300); }

module.exports = { STAGES, STAGE_LABELS, dirOf, create, load, save, list, log, validId, emptyStages };
