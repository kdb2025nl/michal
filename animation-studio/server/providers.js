'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { readJson, writeJson, sha, py, sleep, redact, audioDuration } = require('./util');
const pricing = require('./pricing');

const hashes = {
  image: (prompt, size, quality, mock) => sha({ prompt, size, quality, mock: !!mock, model: config.FAL_MODELS.image }),
  music: (prompt, ms, mock) => sha({ prompt, ms, mock: !!mock, model: config.FAL_MODELS.music }),
  tts: (text, voice, language, mock, attempt = 0) => sha({ text, voice, language, attempt, mock: !!mock, model: config.FAL_MODELS.tts }),
};

class SpendLimitError extends Error { constructor(msg) { super(msg); this.name = 'SpendLimitError'; this.code = 'SPEND_LIMIT'; } }
class ConsentError extends Error { constructor(msg) { super(msg); this.name = 'ConsentError'; this.code = 'CONSENT'; } }

// Guard: nothing that looks like a user-provided local file may be part of a Fal request unless the user consented
// to those exact files in the UI (project.consent.sendFiles includes the file name).
function assertNoUserFiles(input, consentedFiles = []) {
  const walk = (v) => {
    if (typeof v === 'string') {
      const isData = /^data:/i.test(v); const isLocal = /^(file:|[a-zA-Z]:\\|\/(home|Users|tmp|mnt)\/)/.test(v) || /uploads[\\/]/.test(v);
      if ((isData || isLocal) && !consentedFiles.some((f) => v.includes(f))) throw new ConsentError('Blocked: request would send a local/user file to Fal without explicit consent.');
    } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
}

class Providers {
  /**
   * ctx: { dir, settings:{maxSpendUsd,maxRetries,imageQuality}, ledger (mutable object), mock:bool, allowPaid:bool, consentFiles:[], onSave:()=>void, log:(msg)=>void }
   */
  constructor(ctx) {
    this.ctx = ctx; this.dir = ctx.dir; this.assets = path.join(ctx.dir, 'assets'); this.pre = (!ctx.mock && !ctx.allowPaid) ? 'draft-' : ''; fs.mkdirSync(this.assets, { recursive: true });
    this.manifestPath = path.join(this.assets, 'manifest.json');
    this.manifest = readJson(this.manifestPath, { entries: {} });
  }
  get usesFal() { return !this.ctx.mock && this.ctx.allowPaid; }
  save() { writeJson(this.manifestPath, this.manifest); this.ctx.onSave && this.ctx.onSave(); }
  log(m) { this.ctx.log && this.ctx.log(m); }

  cached(key, inputHash) {
    const e = this.manifest.entries[key];
    if (e && e.inputHash === inputHash && fs.existsSync(path.join(this.dir, e.file))) return e;
    return null;
  }
  isCached(key, inputHash) { const h = this.cached(key, inputHash); return !!(h && !h.placeholder); }

  guardSpend(usd) {
    const spent = this.ctx.ledger.spentUsd || 0;
    if (spent + usd > this.ctx.settings.maxSpendUsd + 1e-9) throw new SpendLimitError(`Spend limit reached: $${spent.toFixed(4)} spent + $${usd.toFixed(4)} for this call > limit $${this.ctx.settings.maxSpendUsd.toFixed(2)}. Raise the limit in settings to continue.`);
  }
  bill(key, usd) { this.ctx.ledger.spentUsd = Math.round(((this.ctx.ledger.spentUsd || 0) + usd) * 1e6) / 1e6; this.ctx.ledger.calls.push({ key, usd, at: new Date().toISOString() }); this.ctx.onSave && this.ctx.onSave(); }

  async falCall(model, input, usd, key) {
    assertNoUserFiles(input, this.ctx.consentFiles);
    if (!config.hasFalKey()) throw new Error('FAL_KEY is not set on the server. Add it to .env (see .env.example) and restart.');
    this.guardSpend(usd || 0);
    const { fal } = require('@fal-ai/client');
    fal.config({ credentials: process.env.FAL_KEY });
    const retries = this.ctx.settings.maxRetries;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.log(`fal ${model} (${key}) attempt ${attempt + 1}`);
        const r = await fal.subscribe(model, { input, logs: false });
        this.bill(key, usd || 0);
        return { data: r.data, requestId: r.requestId };
      } catch (e) {
        lastErr = new Error(redact(e.message || String(e)));
        const status = e.status || e.statusCode || e.response?.status;
        if (status && status >= 400 && status < 500 && status !== 429) break; // client error: retrying costs money and will not help
        if (attempt < retries) await sleep((Number(process.env.RETRY_BASE_MS) || 2000) * 2 ** attempt);
      }
    }
    throw lastErr;
  }
  async download(url, dest) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }

  remember(key, inputHash, e) { this.manifest.entries[key] = { key, inputHash, createdAt: new Date().toISOString(), ...e }; this.save(); return this.manifest.entries[key]; }
  rel(p) { return path.relative(this.dir, p).split(path.sep).join('/'); }

  // ---------- image ----------
  async image({ id, prompt, size, quality }) {
    const key = `image:${id}`; const inputHash = hashes.image(prompt, size, quality, this.ctx.mock);
    const hit = this.cached(key, inputHash); if (hit && !hit.placeholder) return { ...hit, cached: true };
    const out = path.join(this.assets, `${this.pre}raw-${id}.png`);
    if (this.usesFal) {
      const usd = pricing.imageUnitUsd(size, quality) ?? 0;
      const input = { prompt, image_size: { width: size.width, height: size.height }, quality, num_images: 1, output_format: 'png', background: 'opaque' };
      const { data, requestId } = await this.falCall(config.FAL_MODELS.image, input, usd, key);
      const url = data.images?.[0]?.url; if (!url) throw new Error('image response had no URL');
      await this.download(url, out);
      return this.remember(key, inputHash, { model: config.FAL_MODELS.image, requestId, prompt, size, quality, url, file: this.rel(out), usd });
    }
    // local stand-in (mock project or Draft mode without paid calls)
    await py('mock_assets.py', ['image', out, String(size.width), String(size.height), String(sha(id))]);
    const placeholder = !this.ctx.mock;
    return this.remember(placeholder ? `draft-${key}` : key, inputHash, { model: 'local-mock', requestId: 'mock-' + inputHash, prompt, size, file: this.rel(out), usd: 0, mock: true, placeholder });
  }

  // ---------- music ----------
  async music({ prompt, seconds }) {
    const key = 'music'; const ms = Math.max(3000, Math.min(600000, Math.round(seconds * 1000)));
    const inputHash = hashes.music(prompt, ms, this.ctx.mock);
    const hit = this.cached(key, inputHash); if (hit && !hit.placeholder) return { ...hit, cached: true };
    if (this.usesFal) {
      const usd = Math.ceil(ms / 60000) * pricing.table().music.perStartedMinuteUsd;
      const input = { prompt: prompt.slice(0, 4000), music_length_ms: ms, force_instrumental: true, output_format: 'mp3_44100_128' };
      const { data, requestId } = await this.falCall(config.FAL_MODELS.music, input, usd, key);
      const url = data.audio?.url; if (!url) throw new Error('music response had no URL');
      const out = path.join(this.assets, 'music.mp3'); await this.download(url, out);
      return this.remember(key, inputHash, { model: config.FAL_MODELS.music, requestId, prompt, ms, url, file: this.rel(out), usd });
    }
    const out = path.join(this.assets, `${this.pre}music.wav`);
    await py('mock_assets.py', ['music', out, String(ms / 1000), '110']);
    const placeholder = !this.ctx.mock;
    return this.remember(placeholder ? 'draft-music' : key, inputHash, { model: 'local-mock', requestId: 'mock-' + inputHash, prompt, ms, file: this.rel(out), usd: 0, mock: true, placeholder });
  }

  // ---------- tts ----------
  async tts({ sceneId, text, voice, language, attempt = 0 }) {
    const key = `tts:${sceneId}`; const inputHash = hashes.tts(text, voice, language, this.ctx.mock, attempt);
    const hit = this.cached(key, inputHash); if (hit && !hit.placeholder) return { ...hit, cached: true };
    if (this.usesFal) {
      const usd = (text.length / 1000) * pricing.table().tts.per1000CharsUsd;
      const input = { text, voice, language_code: language, timestamps: true, stability: 0.5, apply_text_normalization: 'auto' };
      const { data, requestId } = await this.falCall(config.FAL_MODELS.tts, input, usd, key);
      const url = data.audio?.url; if (!url) throw new Error('TTS response had no URL');
      const out = path.join(this.assets, `voice-${sceneId}${attempt ? '-r' + attempt : ''}.mp3`); await this.download(url, out);
      return this.remember(key, inputHash, { model: config.FAL_MODELS.tts, requestId, text, voice, language, url, file: this.rel(out), usd, timestamps: data.timestamps || null });
    }
    const out = path.join(this.assets, `${this.pre}voice-${sceneId}.wav`);
    await py('mock_assets.py', ['speech', out, text]);
    const placeholder = !this.ctx.mock;
    return this.remember(placeholder ? `draft-${key}` : key, inputHash, { model: 'local-mock-voice', requestId: 'mock-' + inputHash, text, voice, language, file: this.rel(out), usd: 0, mock: true, placeholder });
  }

  // ---------- whisper ----------
  async whisper({ sceneId, language, voiceEntry }) {
    const key = `stt:${sceneId}`; const inputHash = sha({ f: voiceEntry.inputHash, language, model: config.FAL_MODELS.stt, mock: !!this.ctx.mock });
    const hit = this.cached(key, inputHash); if (hit) return { ...hit, cached: true };
    if (this.usesFal && !voiceEntry.mock) {
      const { fal } = require('@fal-ai/client'); fal.config({ credentials: process.env.FAL_KEY });
      const upload = async () => fal.storage.upload(new Blob([fs.readFileSync(path.join(this.dir, voiceEntry.file))])); // generated audio only, never user files
      const input = { audio_url: voiceEntry.url || await upload(), task: 'transcribe', language, chunk_level: 'word' };
      let res;
      try { res = await this.falCall(config.FAL_MODELS.stt, input, 0, key); } catch (e) {
        if (!voiceEntry.url) throw e; // Fal media URLs can expire: retry once with a fresh upload of the local file
        res = await this.falCall(config.FAL_MODELS.stt, { ...input, audio_url: await upload() }, 0, key);
      }
      const { data, requestId } = res;
      const words = (data.chunks || []).filter((c) => Array.isArray(c.timestamp)).map((c) => ({ word: String(c.text).trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
      return this.remember(key, inputHash, { model: config.FAL_MODELS.stt, requestId, text: data.text || '', words, file: voiceEntry.file, usd: 0 });
    }
    // mock: the "transcript" is the target text -> validation marked NOT TESTED in reports
    return this.remember(key, inputHash, { model: 'local-mock-whisper', requestId: 'mock-' + inputHash, text: voiceEntry.text, words: [], file: voiceEntry.file, usd: 0, mock: true });
  }

  async prepareVoiceFile(entry) { return { file: entry.file, duration: await audioDuration(path.join(this.dir, entry.file)) }; }
}

module.exports = { hashes, Providers, SpendLimitError, ConsentError, assertNoUserFiles };
