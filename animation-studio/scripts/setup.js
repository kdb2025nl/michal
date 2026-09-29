'use strict';
// One-time setup: creates a project-local Python virtualenv (.venv), installs requirements into it, runs the doctor.
// A venv is required on macOS (Homebrew Python refuses global "pip install", PEP 668) and is cleaner on Windows too.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../server/config');

const sys = config.findPython({ system: true });
if (!sys) {
  console.error('Python 3 not found. Install it:\n  Windows: winget install Python.Python.3.12\n  macOS:   brew install python@3.12\nthen reopen the terminal and run "npm run setup" again.');
  process.exit(1);
}
const venv = path.join(config.ROOT, '.venv');
if (!fs.existsSync(venv)) {
  console.log('Creating .venv with', sys.join(' '));
  const r = spawnSync(sys[0], [...sys.slice(1), '-m', 'venv', venv], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('venv creation failed. On Debian/Ubuntu: sudo apt install python3-venv'); process.exit(r.status || 1); }
}
const vpy = config.findPython();
const pip = spawnSync(vpy[0], [...vpy.slice(1), '-m', 'pip', 'install', '--upgrade', 'pip', '-r', path.join(config.ROOT, 'requirements.txt')], { stdio: 'inherit' });
if (pip.status !== 0) process.exit(pip.status || 1);
spawnSync(process.execPath, [path.join(__dirname, 'doctor.js')], { stdio: 'inherit' });
