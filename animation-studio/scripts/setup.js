'use strict';
// One-time setup: installs Python packages and runs the doctor.
const { spawnSync } = require('child_process');
const path = require('path');
const config = require('../server/config');
const py = config.findPython();
if (!py) { console.error('Python 3 not found. Install it:  winget install Python.Python.3.12   then reopen PowerShell and run "npm run setup" again.'); process.exit(1); }
const r = spawnSync(py[0], [...py.slice(1), '-m', 'pip', 'install', '-r', path.join(config.ROOT, 'requirements.txt')], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
spawnSync(process.execPath, [path.join(__dirname, 'doctor.js')], { stdio: 'inherit' });
