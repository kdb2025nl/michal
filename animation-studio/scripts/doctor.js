'use strict';
// Checks Node, Python (+ packages), FFmpeg/ffprobe, Chrome/Edge and .env. Prints exact Windows install hints.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../server/config');
let bad = 0;
const row = (ok, name, detail, fix) => { console.log(`${ok ? ' OK ' : 'FAIL'}  ${name}: ${detail}`); if (!ok) { bad++; if (fix) console.log(`      -> ${fix}`); } };

const major = Number(process.versions.node.split('.')[0]);
row(major >= 20, 'Node.js', process.version, 'Windows: winget install OpenJS.NodeJS.LTS | macOS: brew install node   (then reopen the terminal)');
const py = config.findPython();
row(!!py, 'Python 3', py ? py.join(' ') + (py[0].includes('.venv') ? ' (project venv)' : ' (system - run npm run setup to create .venv)') : 'not found', 'Windows: winget install Python.Python.3.12 | macOS: brew install python@3.12   (then reopen the terminal, run npm run setup)');
if (py) {
  const r = spawnSync(py[0], [...py.slice(1), '-c', 'import numpy, librosa, PIL, soundfile; print(librosa.__version__)'], { encoding: 'utf8' });
  row(r.status === 0, 'Python packages', r.status === 0 ? 'numpy, librosa ' + r.stdout.trim() + ', Pillow, soundfile' : 'missing', 'npm run setup   (runs: pip install -r requirements.txt)');
}
const ff = spawnSync(config.findFfmpeg(), ['-version'], { encoding: 'utf8' });
row(ff.status === 0, 'FFmpeg', ff.status === 0 ? ff.stdout.split('\n')[0] : 'not runnable', 'npm install   (ffmpeg-static) or: winget install Gyan.FFmpeg and set FFMPEG_PATH in .env');
if (ff.status === 0) {
  const enc = spawnSync(config.findFfmpeg(), ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
  const missing = ['libx264', 'libvpx-vp9', 'libopus', 'aac'].filter((e) => !new RegExp('\\b' + e + '\\b').test(enc));
  row(!missing.length, 'FFmpeg encoders', missing.length ? 'missing ' + missing.join(', ') : 'libx264, libvpx-vp9, libopus, aac', 'install a full FFmpeg (macOS: brew install ffmpeg; Windows: winget install Gyan.FFmpeg) and set FFMPEG_PATH in .env');
}
const fp = spawnSync(config.findFfprobe(), ['-version'], { encoding: 'utf8' });
row(fp.status === 0, 'ffprobe', fp.status === 0 ? fp.stdout.split('\n')[0] : 'not runnable', 'npm install   (ffprobe-static)');
const cr = config.findChrome();
row(!!cr, 'Chrome / Edge', cr || 'not found', 'Windows: winget install Google.Chrome (Edge is auto-detected) | macOS: brew install --cask google-chrome (Chrome/Chromium/Edge/Brave auto-detected) | or set CHROME_PATH in .env');
console.log(` ${fs.existsSync(path.join(config.ROOT, '.env')) ? ' OK ' : 'INFO'}  .env: ${fs.existsSync(path.join(config.ROOT, '.env')) ? 'present' : 'missing (needed only for real Fal generation) -> Copy-Item .env.example .env  and put your FAL_KEY in it'}`);
console.log(`\nFAL_KEY: ${config.hasFalKey() ? 'set (value not shown)' : 'not set -> Draft and Mock modes only'}`);
console.log(bad ? `\n${bad} problem(s) found.` : '\nAll good. Start with: npm run app');
process.exit(bad ? 1 : 0);
