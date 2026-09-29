'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no dependency). Never logs values.
function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined && v !== '') process.env[m[1]] = v;
  }
}
loadEnv();

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

function firstExisting(list) { return list.find((p) => p && fs.existsSync(p)); }

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const cands = [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    path.join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/usr/bin/microsoft-edge', '/snap/bin/chromium',
  ];
  const found = firstExisting(cands);
  if (found) return found;
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw && fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((n) => /^chromium-\d+/.test(n)).sort().reverse()) {
      const c = firstExisting([path.join(pw, d, 'chrome-linux/chrome'), path.join(pw, d, 'chrome-linux64/chrome'), path.join(pw, d, 'chrome-win/chrome.exe')]);
      if (c) return c;
    }
  }
  return null;
}

function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (e) { /* fallthrough */ }
  return 'ffmpeg';
}
function findFfprobe() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  try { const p = require('ffprobe-static').path; if (p && fs.existsSync(p)) return p; } catch (e) { /* fallthrough */ }
  return 'ffprobe';
}

const venvPython = () => firstExisting([path.join(ROOT, '.venv', 'bin', 'python'), path.join(ROOT, '.venv', 'Scripts', 'python.exe')]);
// System Python (used only to create the venv). Order matters: on macOS "python" often does not exist, on Windows "py -3" is the launcher.
const systemPythons = () => (process.env.PYTHON ? [[process.env.PYTHON]] : [['py', '-3'], ['python3'], ['python']]);
function findPython(opts = {}) {
  const v = !opts.system && venvPython();
  const cands = v ? [[v]] : systemPythons();
  for (const c of cands) {
    const r = spawnSync(c[0], [...c.slice(1), '-c', 'import sys;print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return c;
  }
  return null;
}

const config = {
  ROOT,
  PROJECTS_DIR: process.env.PROJECTS_DIR ? path.resolve(process.env.PROJECTS_DIR) : path.join(ROOT, 'projects'),
  PORT: num(process.env.PORT, 4377),
  MAX_SPEND_USD: num(process.env.MAX_SPEND_USD, 2.0),
  MAX_RETRIES: num(process.env.MAX_RETRIES, 2),
  MAX_RENDER_ATTEMPTS: num(process.env.MAX_RENDER_ATTEMPTS, 2),
  hasFalKey: () => Boolean(process.env.FAL_KEY),
  HOST: process.env.HOST || '127.0.0.1',
  findChrome, findFfmpeg, findFfprobe, findPython,
  FAL_MODELS: {
    image: 'openai/gpt-image-2.5/sunburst/text-to-image',
    music: 'fal-ai/elevenlabs/music',
    tts: 'fal-ai/elevenlabs/tts/eleven-v3',
    stt: 'fal-ai/whisper',
  },
};
module.exports = config;
