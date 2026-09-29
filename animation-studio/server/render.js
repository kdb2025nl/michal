'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const config = require('./config');
const { ffmpeg, ffprobe, audioDuration } = require('./util');

async function openPlayer(origin, projectId, extraQuery = '') {
  const exe = config.findChrome();
  if (!exe) throw new Error('No Chrome/Edge/Chromium found. Install Google Chrome or set CHROME_PATH in .env.');
  const tl = JSON.parse(fs.readFileSync(path.join(config.PROJECTS_DIR, projectId, 'timeline.json'), 'utf8'));
  const browser = await puppeteer.launch({
    executablePath: exe, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--font-render-hinting=none', '--disable-lcd-text', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  if (process.env.APP_PASSWORD) await page.authenticate({ username: 'studio', password: process.env.APP_PASSWORD });
  await page.setViewport({ width: tl.width, height: tl.height, deviceScaleFactor: 1 });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => problems.push('request failed: ' + r.url().replace(origin, '')));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url().replace(origin, '')}`); });
  await page.goto(`${origin}/engine/player.html?project=${projectId}${extraQuery}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  return { browser, page, problems, timeline: tl };
}

async function pageInfo(page) {
  return page.evaluate(() => ({ errors: window.__errors.concat(window.__engine ? window.__engine.errors : []), missing: window.__engine ? window.__engine.missing : ['engine'], fx: window.__engine ? window.__engine.fxKind : null }));
}

const grab = (page, t, type, q) => page.evaluate((tt, ty, qq) => { window.renderFrame(tt); return document.getElementById('c').toDataURL(ty, qq).split(',')[1]; }, t, type, q);

// Determinism check: same t -> identical pixels (also after rendering other frames in between).
async function checkDeterminism(page, timeline) {
  const ts = [0.5, timeline.duration * 0.5, Math.max(0, timeline.duration - 0.2)];
  const res = [];
  for (const t of ts) {
    const a = await grab(page, t, 'image/png'); await grab(page, (t + 1.7) % timeline.duration, 'image/png'); const b = await grab(page, t, 'image/png');
    res.push({ t: +t.toFixed(2), identical: a === b });
  }
  return { ok: res.every((r) => r.identical), samples: res };
}

async function layoutSamples(page, timeline) {
  const times = new Set();
  for (const s of timeline.scenes) { times.add(+(s.start + Math.min(s.duration * 0.55, s.duration - 0.2)).toFixed(3)); times.add(+(s.start + s.duration - 0.12).toFixed(3)); }
  for (const c of timeline.captions) times.add(+((c.start + c.end) / 2).toFixed(3));
  times.add(+(timeline.duration - 0.05).toFixed(3));
  const out = [];
  for (const t of [...times].sort((a, b) => a - b)) out.push(await page.evaluate((tt) => window.__engine.layoutReport(tt), t));
  return out;
}

async function renderFrames(page, timeline, framesDir, { quality, onProgress }) {
  fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir, { recursive: true });
  const n = Math.round(timeline.duration * timeline.fps);
  for (let i = 0; i < n; i++) {
    const t = i / timeline.fps;
    const b64 = await grab(page, t, 'image/jpeg', quality);
    fs.writeFileSync(path.join(framesDir, `f${String(i + 1).padStart(5, '0')}.jpg`), Buffer.from(b64, 'base64'));
    if (onProgress && i % 10 === 0) onProgress(i / n);
  }
  if (onProgress) onProgress(1);
  return n;
}

async function mixAudio(dir, timeline) {
  const out = path.join(dir, 'output'); fs.mkdirSync(out, { recursive: true });
  const T = timeline.duration; const args = []; const chains = []; const voices = timeline.audio.voice;
  voices.forEach((v) => args.push('-i', path.join(dir, v.file)));
  let mIdx = -1;
  if (timeline.audio.music) { mIdx = voices.length; args.push('-i', path.join(dir, timeline.audio.music.file)); }
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  voices.forEach((v, i) => { const ms = Math.round(v.start * 1000); chains.push(`[${i}:a]${fmt},adelay=${ms}|${ms}[v${i}]`); });
  if (voices.length) chains.push(`${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0,apad=whole_dur=${T},atrim=0:${T}[voice]`);
  else chains.push(`anullsrc=r=48000:cl=stereo,atrim=0:${T}[voice]`);
  const stems = ['-map', '[voice]', '-ar', '48000', path.join(out, 'voice.wav')];
  if (mIdx >= 0) {
    const mdur = await audioDuration(path.join(dir, timeline.audio.music.file));
    const loop = mdur < T ? `aloop=loop=-1:size=${Math.ceil(mdur * 48000) + 4800},` : '';
    chains.push(`[${mIdx}:a]${fmt},${loop}atrim=0:${T},volume=${timeline.audio.music.gain},afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, T - 1.6)}:d=1.6[music]`);
    stems.push('-map', '[music]', '-ar', '48000', path.join(out, 'music.wav'));
  }
  await ffmpeg([...args, '-filter_complex', chains.join(';'), ...stems]);
  const ratio = Math.min(20, Math.max(4, timeline.audio.duckDb / 1.5));
  if (mIdx >= 0) {
    await ffmpeg(['-i', path.join(out, 'music.wav'), '-i', path.join(out, 'voice.wav'), '-filter_complex',
      `[1:a]asplit=2[vk][vm];[0:a][vk]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=15:release=400:makeup=1[md];[md][vm]amix=inputs=2:normalize=0,alimiter=limit=0.9[mix]`,
      '-map', '[mix]', '-ar', '48000', path.join(out, 'mix.wav')]);
  } else await ffmpeg(['-i', path.join(out, 'voice.wav'), '-af', 'alimiter=limit=0.9', path.join(out, 'mix.wav')]);
  return { mix: 'output/mix.wav', voice: 'output/voice.wav', music: mIdx >= 0 ? 'output/music.wav' : null };
}

async function encode(dir, timeline, { draft, name }) {
  const out = path.join(dir, 'output'); const frames = path.join(dir, 'frames', 'f%05d.jpg'); const T = timeline.duration;
  const mp4 = path.join(out, `${name}.mp4`); const webm = path.join(out, `${name}.webm`);
  const common = ['-framerate', String(timeline.fps), '-i', frames, '-i', path.join(out, 'mix.wav'), '-t', String(T)];
  await ffmpeg([...common, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', draft ? '27' : '18', '-preset', draft ? 'veryfast' : 'medium', '-r', String(timeline.fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-metadata', 'title=Animation Studio render', mp4]);
  await ffmpeg([...common, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', draft ? '38' : '32', '-row-mt', '1', '-deadline', draft ? 'realtime' : 'good', '-cpu-used', draft ? '8' : '4', '-r', String(timeline.fps),
    '-c:a', 'libopus', '-b:a', '128k', webm]);
  return { mp4: `output/${name}.mp4`, webm: `output/${name}.webm` };
}

function writeSrt(dir, timeline) {
  const f = (t) => { const ms = Math.round(t * 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  const srt = timeline.captions.map((c, i) => `${i + 1}\n${f(c.start)} --> ${f(c.end)}\n${c.text}\n`).join('\n');
  fs.writeFileSync(path.join(dir, 'output', 'captions.srt'), srt);
}

module.exports = { openPlayer, pageInfo, grab, checkDeterminism, layoutSamples, renderFrames, mixAudio, encode, writeSrt, ffprobe };
