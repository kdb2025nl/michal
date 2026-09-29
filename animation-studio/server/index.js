'use strict';
const config = require('./config');
const { createApp } = require('./app');
const fs = require('fs');

fs.mkdirSync(config.PROJECTS_DIR, { recursive: true });
const app = createApp();
const server = app.listen(config.PORT, '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  app.get('runner').origin = origin; app.get('runner').recover();
  console.log(`\nAnimation Studio running at ${origin}`);
  console.log(`FAL_KEY: ${config.hasFalKey() ? 'set (value never shown)' : 'NOT set - only Draft/Mock modes will work'}`);
  if (process.platform === 'win32' && !process.env.NO_OPEN) require('child_process').spawn('cmd', ['/c', 'start', '', origin], { detached: true, stdio: 'ignore' }).unref();
  console.log(`Spend limit per project: $${config.MAX_SPEND_USD.toFixed(2)}  |  retries: ${config.MAX_RETRIES}  |  Chrome: ${config.findChrome() || 'NOT FOUND'}\n`);
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${config.PORT} is busy. Set PORT in .env.` : e.message); process.exit(1); });
