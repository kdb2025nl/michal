"""QA helpers. Usage: qa_tools.py <frames|contact|audio> job.json out.json"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw


def luma(path, size=(160, 90)):
    im = Image.open(path).convert("L").resize(size, Image.BILINEAR)
    return np.asarray(im, dtype=np.float32)


def frames(job):
    out = {"frames": [], "pairs": []}
    for f in job["frames"]:
        a = luma(f["file"])
        out["frames"].append({"label": f["label"], "mean": round(float(a.mean()), 2), "std": round(float(a.std()), 2)})
    for p in job.get("pairs", []):
        a, b = luma(p["a"]), luma(p["b"])
        out["pairs"].append({"label": p["label"], "diff": round(float(np.abs(a - b).mean() / 255.0), 4)})
    return out


def contact(job):
    files, labels = job["files"], job["labels"]
    tw = job.get("thumbWidth", 480)
    ims = [Image.open(f).convert("RGB") for f in files]
    ratio = ims[0].height / ims[0].width
    th = int(tw * ratio)
    cols = job.get("cols", 3)
    rows = (len(ims) + cols - 1) // cols
    pad, lab = 12, 26
    sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + lab + pad) + pad), (16, 20, 28))
    d = ImageDraw.Draw(sheet)
    for i, im in enumerate(ims):
        x = pad + (i % cols) * (tw + pad)
        y = pad + (i // cols) * (th + lab + pad)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + lab))
        d.text((x, y + 6), labels[i], fill=(220, 230, 240))
    sheet.save(job["out"], "PNG", optimize=True)
    return {"out": job["out"], "size": list(sheet.size)}


def audio(job):
    import soundfile as sf
    def load(p):
        y, sr = sf.read(p, always_2d=True)
        return y.mean(axis=1), sr
    mix, sr = load(job["mix"])
    res = {"mixPeak": round(float(np.max(np.abs(mix))), 4)}
    res["mixPeakDb"] = round(20 * np.log10(max(res["mixPeak"], 1e-8)), 2)
    res["clippedSamples"] = int(np.sum(np.abs(mix) >= 0.999))
    res["mixRmsDb"] = round(20 * np.log10(max(float(np.sqrt(np.mean(mix ** 2))), 1e-8)), 2)
    if job.get("voice") and job.get("music"):
        v, _ = load(job["voice"]); m, _ = load(job["music"])
        n = min(len(v), len(m))
        v, m = v[:n], m[:n]
        win = int(sr * 0.05)
        k = n // win
        vr = np.sqrt(np.mean(v[: k * win].reshape(k, win) ** 2, axis=1))
        mr = np.sqrt(np.mean(m[: k * win].reshape(k, win) ** 2, axis=1))
        active = vr > 0.01
        if active.any():
            vdb = 20 * np.log10(max(float(np.sqrt(np.mean(vr[active] ** 2))), 1e-8))
            mdb = 20 * np.log10(max(float(np.sqrt(np.mean(mr[active] ** 2))), 1e-8))
            res.update({"voiceRmsDb": round(vdb, 2), "musicRmsDuringVoiceDb": round(mdb, 2), "voiceToMusicDb": round(vdb - mdb, 2), "voiceActiveSec": round(float(active.sum() * 0.05), 2)})
        else:
            res.update({"voiceRmsDb": None, "voiceToMusicDb": None, "voiceActiveSec": 0})
    return res


if __name__ == "__main__":
    cmd, jp, op = sys.argv[1], sys.argv[2], sys.argv[3]
    job = json.load(open(jp, encoding="utf-8"))
    result = {"frames": frames, "contact": contact, "audio": audio}[cmd](job)
    json.dump(result, open(op, "w", encoding="utf-8"))
