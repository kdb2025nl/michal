'use strict';
// Checks Node, Python (+ packages), FFmpeg/ffprobe, Chrome/Edge and .env. Prints exact Windows install hints.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../server/config');
let bad = 0;
const row = (ok, name, detail, fix) => { console.log(`${ok ? ' OK ' : 'FAIL'}  ${name}: ${detail}`); if (!ok) { bad++; if (fix) console.log(`      -> ${fix}`); } };

const major = Number(process.versions.node.split('.')[0]);
row(major >= 20, 'Node.js', process.version, 'winget install OpenJS.NodeJS.LTS   (then reopen PowerShell)');
const py = config.findPython();
row(!!py, 'Python 3', py ? py.join(' ') : 'not found', 'winget install Python.Python.3.12   (then reopen PowerShell)');
if (py) {
  const r = spawnSync(py[0], [...py.slice(1), '-c', 'import numpy, librosa, PIL, soundfile; print(librosa.__version__)'], { encoding: 'utf8' });
  row(r.status === 0, 'Python packages', r.status === 0 ? 'numpy, librosa ' + r.stdout.trim() + ', Pillow, soundfile' : 'missing', 'npm run setup   (runs: pip install -r requirements.txt)');
}
const ff = spawnSync(config.findFfmpeg(), ['-version'], { encoding: 'utf8' });
row(ff.status === 0, 'FFmpeg', ff.status === 0 ? ff.stdout.split('\n')[0] : 'not runnable', 'npm install   (ffmpeg-static) or: winget install Gyan.FFmpeg and set FFMPEG_PATH in .env');
const fp = spawnSync(config.findFfprobe(), ['-version'], { encoding: 'utf8' });
row(fp.status === 0, 'ffprobe', fp.status === 0 ? fp.stdout.split('\n')[0] : 'not runnable', 'npm install   (ffprobe-static)');
const cr = config.findChrome();
row(!!cr, 'Chrome / Edge', cr || 'not found', 'winget install Google.Chrome   or set CHROME_PATH in .env (Edge is used automatically if present)');
console.log(` ${fs.existsSync(path.join(config.ROOT, '.env')) ? ' OK ' : 'INFO'}  .env: ${fs.existsSync(path.join(config.ROOT, '.env')) ? 'present' : 'missing (needed only for real Fal generation) -> Copy-Item .env.example .env  and put your FAL_KEY in it'}`);
console.log(`\nFAL_KEY: ${config.hasFalKey() ? 'set (value not shown)' : 'not set -> Draft and Mock modes only'}`);
console.log(bad ? `\n${bad} problem(s) found.` : '\nAll good. Start with: npm run app');
process.exit(bad ? 1 : 0);
