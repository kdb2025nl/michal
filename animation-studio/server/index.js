'use strict';
const config = require('./config');
const { createApp } = require('./app');
const fs = require('fs');

fs.mkdirSync(config.PROJECTS_DIR, { recursive: true });
if (!['127.0.0.1', 'localhost', '::1'].includes(config.HOST) && !process.env.APP_PASSWORD) {
  console.error(`Refusing to listen on ${config.HOST} without APP_PASSWORD: anyone reaching this server could spend your FAL_KEY. Set APP_PASSWORD in .env.`); process.exit(1);
}
const app = createApp();
const server = app.listen(config.PORT, config.HOST, () => {
  const origin = `http://127.0.0.1:${server.address().port}`; // internal renderer always talks to loopback
  app.get('runner').origin = origin; app.get('runner').recover();
  console.log(`\nAnimation Studio running at ${origin}${config.HOST !== '127.0.0.1' ? ` (bound to ${config.HOST}:${config.PORT}, password protected)` : ''}`);
  console.log(`FAL_KEY: ${config.hasFalKey() ? 'set (value never shown)' : 'NOT set - only Draft/Mock modes will work'}`);
  if (!process.env.NO_OPEN && !process.env.APP_PASSWORD) {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', origin]] : process.platform === 'darwin' ? ['open', [origin]] : null;
    if (opener) require('child_process').spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  }
  console.log(`Spend limit per project: $${config.MAX_SPEND_USD.toFixed(2)}  |  retries: ${config.MAX_RETRIES}  |  Chrome: ${config.findChrome() || 'NOT FOUND'}\n`);
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${config.PORT} is busy. Set PORT in .env.` : e.message); process.exit(1); });
