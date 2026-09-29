"""Local stand-ins for paid Fal assets (used by mock mode / tests). Deterministic per seed.
   image <out.png> <w> <h> <seed> | music <out.wav> <seconds> [bpm] | speech <out.wav> <text> | screenshot <out.png> <label>
   Everything produced here is a labelled TEST asset, never a depiction of a real product."""
import sys, math, hashlib
import numpy as np
from PIL import Image, ImageDraw
import soundfile as sf

SR = 44100


def seed_of(*a):
    return int(hashlib.sha256("|".join(map(str, a)).encode()).hexdigest()[:8], 16)


def image(out, w, h, seed):
    rng = np.random.default_rng(seed_of(seed) % (2**31))
    x = np.linspace(0, 1, w)[None, :]
    y = np.linspace(0, 1, h)[:, None]
    a = rng.uniform(0.2, 0.9)
    base = np.stack([0.05 + 0.10 * (x * a + y * (1 - a)), 0.16 + 0.25 * (x * (1 - a) + y * a), 0.30 + 0.35 * (x + y) / 2], axis=-1)
    im = Image.fromarray((np.clip(base, 0, 1) * 255).astype("uint8"))
    d = ImageDraw.Draw(im, "RGBA")
    for _ in range(5):
        r = int(rng.uniform(0.15, 0.45) * min(w, h))
        cx, cy = int(rng.uniform(0, w)), int(rng.uniform(0, h))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(19, 168, 158, int(rng.uniform(12, 40))))
    im.save(out)


def music(out, seconds, bpm=110):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    beat = 60.0 / bpm
    y = np.zeros(n)
    chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (261.63, 329.63, 392.0), (196.0, 246.94, 293.66)]
    for i, f in enumerate([c for c in chords]):
        seg = (t // (beat * 4)).astype(int) % 4 == i
        for fr in f:
            y += np.where(seg, 0.05 * np.sin(2 * np.pi * fr * t), 0)
    k = 0
    while k * beat < seconds:
        s = int(k * beat * SR)
        m = min(int(0.25 * SR), n - s)
        if m <= 0:
            break
        tt = np.arange(m) / SR
        f = 50 + 90 * np.exp(-tt * 25)
        env = np.exp(-tt * 14)
        amp = 0.55 if k % 4 == 0 else 0.4
        y[s:s + m] += amp * np.sin(2 * np.pi * np.cumsum(f) / SR) * env
        h = s + int(beat * SR / 2)
        mh = min(int(0.05 * SR), n - h)
        if mh > 0:
            y[h:h + mh] += 0.05 * np.random.default_rng(k).normal(size=mh) * np.exp(-np.arange(mh) / (0.01 * SR))
        k += 1
    y *= np.minimum(1, t / 0.5) * np.minimum(1, (seconds - t) / 1.0)
    y = y / max(1e-6, np.max(np.abs(y))) * 0.8
    sf.write(out, y, SR)


def speech(out, text):
    words = text.split()
    dur = max(1.4, len(words) * 0.38 + 0.3)
    n = int(dur * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed_of(text))
    y = np.zeros(n)
    pos = 0.05
    for w in words:
        for _ in range(max(1, len(w) // 3)):
            L = rng.uniform(0.09, 0.15)
            f0 = rng.uniform(110, 170)
            s, e = int(pos * SR), min(n, int((pos + L) * SR))
            if e <= s:
                break
            tt = t[s:e] - t[s]
            env = np.sin(np.pi * tt / L) ** 2
            v = sum((1.0 / k) * np.sin(2 * np.pi * f0 * k * tt) for k in range(1, 9))
            y[s:e] += env * v * 0.12
            pos += L + 0.01
        pos += 0.07
    y = y / max(1e-6, np.max(np.abs(y))) * 0.7
    sf.write(out, y, SR)


def screenshot(out, label):
    im = Image.new("RGB", (1600, 900), (245, 247, 250))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 1600, 70], fill=(226, 232, 240))
    d.text((24, 26), "TEST SCREENSHOT PLACEHOLDER - not a real product UI", fill=(60, 60, 60))
    for i in range(7):
        y = 120 + i * 96
        d.rectangle([60, y, 1540, y + 72], outline=(203, 213, 225), fill=(255, 255, 255))
        d.text((80, y + 28), f"{label} - placeholder row {i + 1}", fill=(90, 100, 120))
    im.save(out)


if __name__ == "__main__":
    c = sys.argv[1]
    if c == "image":
        image(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5])
    elif c == "music":
        music(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]) if len(sys.argv) > 4 else 110)
    elif c == "speech":
        speech(sys.argv[2], sys.argv[3])
    elif c == "screenshot":
        screenshot(sys.argv[2], sys.argv[3])
