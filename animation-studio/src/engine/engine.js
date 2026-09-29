/* Deterministic Canvas 2D animation engine (+ optional WebGL2 light/vignette pass).
 * renderFrame(t) is a pure function of (timeline, seed, t): no Date.now, no Math.random.
 * Loaded both by the headless renderer (player.html) and by the UI storyboard preview. */
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const easeOut = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  const easeInOut = (p) => { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  const lerp = (a, b, p) => a + (b - a) * p;
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  // dark or white text, whichever contrasts better with the accent colour (e.g. white on brand red)
  const onAccent = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.056) ? '#FFFFFF' : '#06121F'; };
  const mix = (hex, to, p) => { const a = parseInt(hex.slice(1), 16); const b = parseInt(to.slice(1), 16); const c = (s) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, p)); return `rgb(${c(16)},${c(8)},${c(0)})`; };

  const VERT = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;
  const FRAG = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform vec2 res; uniform float mode; uniform float sweep; uniform float strength;
void main(){
  vec2 c = uv - 0.5; c.x *= res.x/res.y;
  if (mode < 0.5) { float v = smoothstep(0.35, 1.05, length(c)); o = vec4(0.,0.,0., v*strength); }
  else { float d = (uv.x*0.8 + uv.y*0.6) - sweep; float a = exp(-d*d*38.0)*strength; o = vec4(vec3(a), a); }
}`;

  class Engine {
    constructor(opts) {
      this.canvas = opts.canvas; this.tl = opts.timeline; this.base = opts.baseUrl || '';
      this.W = this.canvas.width = this.tl.width; this.H = this.canvas.height = this.tl.height;
      this.ctx = this.canvas.getContext('2d');
      this.buf = document.createElement('canvas'); this.buf.width = this.W; this.buf.height = this.H; this.bctx = this.buf.getContext('2d');
      this.errors = []; this.missing = []; this.images = {}; this.boxes = []; this.fxKind = '2d';
      this.S = Math.min(this.W, this.H) / 1080; this.ts = this.tl.style.textScale || 1;
      this.style = this.tl.style;
      this.font = (w, px) => `${w} ${Math.round(px)}px ${this.style.fontFamily}`;
      this.decor = this.tl.scenes.map((_, i) => { const r = mulberry32(this.tl.seed * 131 + i * 977); return Array.from({ length: 4 }, () => ({ x: r(), y: r(), r: 0.12 + r() * 0.25, k: 0.3 + r() * 0.7 })); });
      this.initFx();
    }
    static async create(opts) { const e = new Engine(opts); await e.load(); return e; }

    initFx() {
      try {
        this.glc = document.createElement('canvas'); this.glc.width = this.W; this.glc.height = this.H;
        const gl = this.glc.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
        if (!gl) return;
        const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
        const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.useProgram(pr); gl.viewport(0, 0, this.W, this.H); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.gl = gl; this.glu = { res: gl.getUniformLocation(pr, 'res'), mode: gl.getUniformLocation(pr, 'mode'), sweep: gl.getUniformLocation(pr, 'sweep'), strength: gl.getUniformLocation(pr, 'strength') };
        this.fxKind = 'webgl2';
      } catch (e) { this.gl = null; this.fxKind = '2d'; this.errors.push('info: WebGL2 unavailable, using 2D fallback (' + e.message + ')'); }
    }
    glPass(mode, sweep, strength, comp) {
      const gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.glu.res, this.W, this.H); gl.uniform1f(this.glu.mode, mode); gl.uniform1f(this.glu.sweep, sweep); gl.uniform1f(this.glu.strength, strength);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.ctx.save(); this.ctx.globalCompositeOperation = comp; this.ctx.drawImage(this.glc, 0, 0, this.W, this.H); this.ctx.restore();
    }
    fx(t, sceneLocal) {
      const ctx = this.ctx; const sweepP = clamp(sceneLocal / 1.8, 0, 1); const sweepOn = sweepP > 0 && sweepP < 1;
      if (this.gl) {
        this.glPass(0, 0, 0.32, 'source-over');
        if (sweepOn) this.glPass(1, lerp(-0.3, 1.6, easeInOut(sweepP)), 0.07, 'lighter');
      } else {
        const g = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.35, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.32)'); ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
        if (sweepOn) { const x = lerp(-0.3, 1.6, easeInOut(sweepP)) * this.W; const lg = ctx.createLinearGradient(x - this.W * 0.2, 0, x + this.W * 0.2, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.06)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, this.W, this.H); }
      }
    }

    async load() {
      const a = this.tl.assets || {};
      for (const f of a.fonts || []) {
        try { const ff = new FontFace(f.family, `url(${this.base}${f.file})`, { weight: String(f.weight || 400), style: f.style || 'normal' }); await ff.load(); document.fonts.add(ff); } catch (e) { this.errors.push('font failed: ' + f.file); this.missing.push(f.file); }
      }
      const jobs = [];
      const add = (key, file) => { if (!file || this.images[key]) return; jobs.push(new Promise((res) => { const im = new Image(); im.onload = () => { this.images[key] = im; res(); }; im.onerror = () => { this.errors.push('asset failed: ' + file); this.missing.push(file); res(); }; im.src = this.base + file; })); };
      for (const [id, f] of Object.entries(a.bg || {})) add('bg:' + id, f);
      for (const [id, f] of Object.entries(a.ui || {})) add('ui:' + id, f);
      if (a.logo) add('logo', a.logo);
      await Promise.all(jobs);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      for (const sc of this.tl.scenes) for (const l of sc.layers) {
        if (l.kind === 'bg' && !this.images['bg:' + l.asset]) this.missing.push('bg:' + l.asset);
        if (l.kind === 'ui' && !this.images['ui:' + l.asset]) this.missing.push('ui:' + l.asset);
      }
      this.missing = [...new Set(this.missing)];
    }

    sceneAt(t) {
      const sc = this.tl.scenes; t = clamp(t, 0, this.tl.duration - 1e-6);
      for (let i = sc.length - 1; i >= 0; i--) if (t >= sc[i].start - 1e-9) return i;
      return 0;
    }
    camAt(sc, tl) {
      const k = sc.camera; if (!k || !k.length) return { zoom: 1, cx: 0.5, cy: 0.5 };
      let i = 0; while (i < k.length - 1 && tl > k[i + 1].t) i++;
      const a = k[i]; const b = k[Math.min(i + 1, k.length - 1)];
      const p = b.t === a.t ? 1 : easeInOut((tl - a.t) / (b.t - a.t));
      let zoom = lerp(a.zoom, b.zoom, p);
      for (const m of sc.syncMarkers || []) if (m.accent && tl >= m.t) zoom += 0.006 * Math.exp(-(tl - m.t) / 0.12); // subtle beat accent
      return { zoom, cx: lerp(a.cx, b.cx, p), cy: lerp(a.cy, b.cy, p) };
    }

    // ---- text helpers ----
    wrap(ctx, text, maxW) {
      const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
      for (const w of words) { const n = cur ? cur + ' ' + w : w; if (ctx.measureText(n).width > maxW && cur) { lines.push(cur); cur = w; } else cur = n; }
      if (cur) lines.push(cur); return lines;
    }
    fitText(ctx, text, weight, px, maxW, maxLines, minPx) {
      let size = px;
      for (;;) {
        ctx.font = this.font(weight, size); const lines = this.wrap(ctx, text, maxW);
        const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
        if ((lines.length <= maxLines && widest <= maxW) || size <= minPx) return { lines, size, widest };
        size *= 0.93;
      }
    }
    record(id, kind, x, y, w, h, fontPx, alpha, text) { this.boxes.push({ id, kind, x, y, w, h, fontPx: fontPx || 0, alpha, text: text || '' }); }

    layoutMetrics() {
      const { W, H, S, ts } = this; const s = this.tl.safe; const portrait = H > W * 1.2;
      const L = W * s.x; const R = W * (1 - s.x); const T = H * s.top; const B = H * (1 - s.bottom);
      const capFs = 44 * S * ts; const capH = 2 * capFs * 1.22 + 30 * S;
      const capTop = B - capH; const contentB = capTop - 16 * S;
      return { L, R, T, B, portrait, capFs, capH, capTop, contentB };
    }

    // ---- scene drawing ----
    drawScene(ctx, idx, tl) {
      const sc = this.tl.scenes[idx]; const m = this.layoutMetrics(); const { W, H, S, ts } = this; const st = this.style;
      const cam = this.camAt(sc, tl);
      const layer = (kind) => sc.layers.find((l) => l.kind === kind);
      const prog = (l) => (l ? easeOut((tl - l.in) / l.dur) : 1);
      const bgL = layer('bg'); const bgImg = bgL && this.images['bg:' + bgL.asset];
      // background with parallax
      ctx.save();
      if (bgImg) {
        const sc0 = Math.max(W / bgImg.width, H / bgImg.height) * cam.zoom * 1.06;
        const dw = bgImg.width * sc0; const dh = bgImg.height * sc0;
        const px = (0.5 - cam.cx) * W * 0.03; const py = (0.5 - cam.cy) * H * 0.03;
        ctx.drawImage(bgImg, (W - dw) / 2 + px, (H - dh) / 2 + py, dw, dh);
      } else {
        const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, st.primaryColor); g.addColorStop(1, mix(st.primaryColor, '#000000', 0.55)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      // restrained decorative shapes (seeded), then legibility scrim
      for (const d of this.decor[idx]) { ctx.fillStyle = hexA(st.accentColor, 0.05 * d.k); ctx.beginPath(); ctx.arc(d.x * W + (0.5 - cam.cx) * W * 0.06, d.y * H, d.r * Math.min(W, H), 0, Math.PI * 2); ctx.fill(); }
      const scrim = sc.type === 'product' ? 0.6 : 0.42;
      ctx.fillStyle = hexA(st.primaryColor, scrim); ctx.fillRect(0, 0, W, H);
      if (!m.portrait && sc.type !== 'product') { const g = ctx.createLinearGradient(0, 0, W * 0.75, 0); g.addColorStop(0, hexA(st.primaryColor, 0.6)); g.addColorStop(1, hexA(st.primaryColor, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      ctx.restore();

      const drawText = (id, kind, lines, size, weight, color, x, y, align, alphaV, lh) => {
        const a = clamp(alphaV, 0, 1); const off = (1 - a) * 22 * S;
        ctx.save(); ctx.globalAlpha = a; ctx.font = this.font(weight, size); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top';
        let maxw = 0; lines.forEach((ln, i) => { ctx.fillText(ln, x, y + off + i * size * lh); maxw = Math.max(maxw, ctx.measureText(ln).width); });
        ctx.restore();
        const bx = align === 'center' ? x - maxw / 2 : align === 'right' ? x - maxw : x;
        this.record(id, kind, bx, y, maxw, lines.length * size * lh - (lh - 1) * size * 0.2, size, a, lines.join(' '));
      };

      const head = layer('headline'); const sub = layer('subline'); const ui = layer('ui'); const cta = layer('cta'); const logo = layer('logo');
      if (sc.type === 'product') {
        // headline as a step pill
        const hp = prog(head); const fs = 42 * S * ts; ctx.font = this.font(700, fs);
        const fit = this.fitText(ctx, head.text, 700, fs, m.R - m.L - 70 * S, 1, 26 * S); ctx.font = this.font(700, fit.size);
        const padX = 26 * S; const padY = 14 * S; const pw = fit.widest + padX * 2; const ph = fit.size * 1.15 + padY * 2;
        ctx.save(); ctx.globalAlpha = hp; ctx.fillStyle = st.accentColor; this.rr(ctx, m.L, m.T + (1 - hp) * 18 * S, pw, ph, ph / 2); ctx.fill(); ctx.restore();
        drawText(head.id, 'headline', fit.lines, fit.size, 700, onAccent(st.accentColor), m.L + padX, m.T + padY * 0.85, 'left', hp, 1.15);
        const areaT = m.T + ph + 26 * S; const areaB = m.contentB; const aw = m.R - m.L; const ah = areaB - areaT;
        const img = ui && this.images['ui:' + ui.asset];
        if (img) {
          const fitS = Math.min(aw / img.width, ah / img.height); const cw = img.width * fitS; const ch = img.height * fitS;
          const cx0 = m.L + (aw - cw) / 2; const cy0 = areaT + (ah - ch) / 2; const up = prog(ui);
          ctx.save(); ctx.globalAlpha = up; ctx.translate(0, (1 - up) * 30 * S);
          ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40 * S; ctx.shadowOffsetY = 14 * S; ctx.fillStyle = '#fff'; this.rr(ctx, cx0, cy0, cw, ch, 14 * S); ctx.fill(); ctx.shadowColor = 'transparent';
          this.rr(ctx, cx0, cy0, cw, ch, 14 * S); ctx.clip();
          const z = 1 + (cam.zoom - 1) * 1.0; const fx = cx0 + cam.cx * cw; const fy = cy0 + cam.cy * ch;
          ctx.translate(fx, fy); ctx.scale(z, z); ctx.translate(-fx, -fy);
          ctx.drawImage(img, cx0, cy0, cw, ch); ctx.restore();
          this.record(ui.id, 'ui', cx0, cy0, cw, ch, 0, up, '');
        }
      } else if (sc.type === 'cta') {
        const cxm = (m.L + m.R) / 2; const w = (m.R - m.L) * (m.portrait ? 1 : 0.8);
        const hs = (m.portrait ? 76 : 84) * S * ts; const fit = this.fitText(ctx, head.text, 800, hs, w, 3, 40 * S);
        const hh = fit.lines.length * fit.size * 1.12; const btnFs = 46 * S * ts; ctx.font = this.font(700, btnFs);
        const btnText = cta ? cta.text : ''; const bw = Math.min(m.R - m.L, ctx.measureText(btnText).width + 90 * S); const bh = btnFs * 1.15 + 44 * S;
        const urlFs = 34 * S * ts; const hasUrl = cta && cta.url; const total = hh + 40 * S + bh + (hasUrl ? 26 * S + urlFs * 1.2 : 0);
        let y = m.T + Math.max(0, (m.contentB - m.T - total) / 2);
        drawText(head.id, 'headline', fit.lines, fit.size, 800, st.textColor, cxm, y, 'center', prog(head), 1.12); y += hh + 40 * S;
        if (cta) {
          const cp = prog(cta); ctx.save(); ctx.globalAlpha = cp; ctx.translate(0, (1 - cp) * 16 * S); ctx.fillStyle = st.accentColor; this.rr(ctx, cxm - bw / 2, y, bw, bh, bh / 2); ctx.fill(); ctx.restore();
          drawText(cta.id, 'cta', [btnText], btnFs, 700, onAccent(st.accentColor), cxm, y + (bh - btnFs * 1.0) / 2 - 2 * S, 'center', cp, 1.0);
          this.boxes[this.boxes.length - 1].bx = [cxm - bw / 2, y, bw, bh];
          if (hasUrl) drawText(cta.id + '-url', 'url', [cta.url], urlFs, 400, 'rgba(255,255,255,0.9)', cxm, y + bh + 26 * S, 'center', cp, 1.2);
        }
      } else { // hook, concept
        const w = (m.R - m.L) * (m.portrait ? 1 : 0.6);
        const hs = (m.portrait ? 78 : 88) * S * ts; const fit = this.fitText(ctx, head.text, 800, hs, w, 4, 40 * S);
        const hh = fit.lines.length * fit.size * 1.12; const subFs = 42 * S * ts;
        let subFit = null; if (sub) subFit = this.fitText(ctx, sub.text, 400, subFs, w, 3, 26 * S);
        const sh = subFit ? subFit.lines.length * subFit.size * 1.3 : 0;
        const barH = 10 * S; const total = barH + 28 * S + hh + (subFit ? 26 * S + sh : 0);
        let y = m.T + Math.max(0, (m.contentB - m.T - total) / 2); const hp = prog(head);
        ctx.save(); ctx.globalAlpha = hp; ctx.fillStyle = st.accentColor; ctx.fillRect(m.L, y, 96 * S * hp, barH); ctx.restore(); y += barH + 28 * S;
        drawText(head.id, 'headline', fit.lines, fit.size, 800, st.textColor, m.L, y, 'left', hp, 1.12); y += hh + 26 * S;
        if (subFit) drawText(sub.id, 'subline', subFit.lines, subFit.size, 400, 'rgba(255,255,255,0.88)', m.L, y, 'left', prog(sub), 1.3);
      }
      if (logo && this.images.logo) {
        const im = this.images.logo; const lh = 56 * S; const lw = Math.min(220 * S, im.width * (lh / im.height)); const lh2 = im.height * (lw / im.width);
        const a = prog(logo); ctx.save(); ctx.globalAlpha = a * 0.95; ctx.drawImage(im, m.R - lw, m.T, lw, lh2); ctx.restore();
        this.record(logo.id, 'logo', m.R - lw, m.T, lw, lh2, 0, a, '');
      }
    }
    rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

    drawCaption(t) {
      const cap = (this.tl.captions || []).find((c) => t >= c.start && t < c.end); if (!cap) return;
      const ctx = this.ctx; const m = this.layoutMetrics(); const { S } = this;
      const a = clamp(Math.min((t - cap.start) / 0.12, (cap.end - t) / 0.12, 1), 0, 1);
      const fit = this.fitText(ctx, cap.text, 600, m.capFs, (m.R - m.L) * 0.92, 2, 30 * S); ctx.font = this.font(600, fit.size);
      const lh = fit.size * 1.22; const h = fit.lines.length * lh + 20 * S; const w = fit.widest + 44 * S;
      const cx = (m.L + m.R) / 2; const bottom = m.B; const y = bottom - h;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(4,10,20,0.62)'; this.rr(ctx, cx - w / 2, y, w, h, 16 * S); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; fit.lines.forEach((ln, i) => ctx.fillText(ln, cx, y + 10 * S + i * lh)); ctx.restore();
      this.record('caption', 'caption', cx - w / 2, y, w, h, fit.size, a, cap.text);
    }

    renderFrame(t) {
      this.boxes = []; const { ctx, W, H } = this; const tl = this.tl;
      t = clamp(t, 0, tl.duration - 1e-6); const idx = this.sceneAt(t); const sc = tl.scenes[idx]; const local = t - sc.start;
      const tr = sc.transitionIn; const inTr = idx > 0 && tr && tr.type !== 'none' && local < tr.duration;
      ctx.clearRect(0, 0, W, H);
      if (inTr) {
        const p = easeInOut(local / tr.duration); const prev = tl.scenes[idx - 1];
        this.drawScene(ctx, idx - 1, prev.duration); const keep = this.boxes; this.boxes = [];
        this.bctx.clearRect(0, 0, W, H); this.drawScene(this.bctx, idx, local);
        ctx.save(); ctx.globalAlpha = p; ctx.drawImage(this.buf, tr.type === 'slide' ? (1 - p) * W * 0.05 : 0, 0); ctx.restore();
        this.boxes.forEach((b) => { b.alpha *= p; }); void keep;
      } else this.drawScene(ctx, idx, local);
      this.fx(t, local);
      this.drawCaption(t);
      return { scene: sc.id, sceneIndex: idx };
    }
    layoutReport(t) { this.renderFrame(t); return { t, W: this.W, H: this.H, safe: this.layoutMetrics(), fx: this.fxKind, boxes: this.boxes.map((b) => ({ ...b })) }; }
    frameDataURL(t, type, q) { this.renderFrame(t); return this.canvas.toDataURL(type || 'image/png', q); }
  }
  root.AnimationEngine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
