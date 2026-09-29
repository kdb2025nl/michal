'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('./config');

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; } };
const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, p); };
const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 16);
const newId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-1500)}`))));
    if (opts.input) p.stdin.end(opts.input);
  });
}
const ffmpeg = (args) => run(config.findFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
async function ffprobe(file) {
  const { out } = await run(config.findFfprobe(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return JSON.parse(out);
}
async function audioDuration(file) { const j = await ffprobe(file); return Number(j.format.duration); }
function py(script, args) {
  const cmd = config.findPython();
  if (!cmd) throw new Error('Python 3 not found. Install Python 3.10+ and run "npm run setup".');
  return run(cmd[0], [...cmd.slice(1), path.join(config.ROOT, 'scripts', script), ...args]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roundTo = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;

// Redact anything key-like from strings that may reach logs/reports.
function redact(s) {
  let out = String(s);
  const key = process.env.FAL_KEY;
  if (key) out = out.split(key).join('[REDACTED]');
  return out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{32}/gi, '[REDACTED]');
}
module.exports = { readJson, writeJson, sha, newId, slug, run, ffmpeg, ffprobe, audioDuration, py, sleep, roundTo, redact };
