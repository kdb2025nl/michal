"""Pillow layer preparation. Usage: prepare_layers.py jobs.json
Ops: cover {src,dst,w,h,quality}  fit {src,dst,maxw}  Both never invent content: they only crop/scale."""
import json, sys
from PIL import Image, ImageOps


def cover(src, dst, w, h, quality=92):
    im = Image.open(src).convert("RGB")
    im = ImageOps.fit(im, (w, h), method=Image.LANCZOS, centering=(0.5, 0.5))
    im.save(dst, "JPEG", quality=quality, optimize=True)
    return {"dst": dst, "size": [w, h]}


def fit(src, dst, maxw):
    im = Image.open(src)
    im = ImageOps.exif_transpose(im).convert("RGBA")
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    im.save(dst, "PNG", optimize=True)
    return {"dst": dst, "size": [im.width, im.height]}


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    res = []
    for j in jobs:
        if j["op"] == "cover":
            res.append(cover(j["src"], j["dst"], j["w"], j["h"], j.get("quality", 92)))
        elif j["op"] == "fit":
            res.append(fit(j["src"], j["dst"], j["maxw"]))
        else:
            raise SystemExit("unknown op " + j["op"])
    print(json.dumps(res))


if __name__ == "__main__":
    main()
