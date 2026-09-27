#!/usr/bin/env python3
"""Key a magenta part sheet and split it into part crops.
Usage: extract_parts.py sheet.png outdir  -> writes part_<i>.png and index.png (labelled overview)"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

def key_magenta(rgb):
    f = rgb.astype(np.float32) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    # magenta-ness: high R and B, low G
    m = np.clip(np.minimum(r, b) - g, 0, 1)
    # distance-based alpha: fully bg when m > 0.55, fully fg when m < 0.18
    a = 1.0 - np.clip((m - 0.18) / (0.55 - 0.18), 0, 1)
    # unmix magenta from semi-transparent pixels
    bg = np.array([1.0, 0.0, 1.0], np.float32)
    aa = np.maximum(a, 1e-3)[..., None]
    c = (f - (1 - aa) * bg) / aa
    c = np.clip(c, 0, 1)
    # residual spill: clamp R and B to not exceed G by much where the pixel reads as pink
    spill = np.clip(np.minimum(c[..., 0], c[..., 2]) - c[..., 1], 0, 1)
    c[..., 0] -= spill * 0.6
    c[..., 2] -= spill * 0.8
    c = np.clip(c, 0, 1)
    return np.dstack([c, a])

def main(sheet, outdir, min_area=600, dilate=5):
    os.makedirs(outdir, exist_ok=True)
    rgb = np.array(Image.open(sheet).convert("RGB"))
    rgba = key_magenta(rgb)
    mask = rgba[..., 3] > 0.35
    lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=dilate))
    objs = ndimage.find_objects(lab)
    parts = []
    for i, sl in enumerate(objs):
        comp = (lab[sl] == i + 1) & mask[sl]
        if comp.sum() < min_area:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        pad = 4
        y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
        y1, x1 = min(rgb.shape[0], y1 + pad), min(rgb.shape[1], x1 + pad)
        crop = rgba[y0:y1, x0:x1].copy()
        own = ndimage.binary_dilation(lab[y0:y1, x0:x1] == i + 1, iterations=2)
        crop[..., 3] *= own
        parts.append(dict(bbox=[int(x0), int(y0), int(x1), int(y1)], crop=crop))
    parts.sort(key=lambda p: (p["bbox"][1] // 150, p["bbox"][0]))
    over = Image.fromarray(rgb).convert("RGB")
    d = ImageDraw.Draw(over)
    meta = []
    for k, p in enumerate(parts):
        im = Image.fromarray((p["crop"] * 255).astype(np.uint8), "RGBA")
        im.save(os.path.join(outdir, f"part_{k}.png"))
        x0, y0, x1, y1 = p["bbox"]
        d.rectangle([x0, y0, x1, y1], outline=(0, 255, 0), width=2)
        d.text((x0 + 4, y0 + 4), str(k), fill=(255, 255, 0))
        meta.append(dict(i=k, bbox=p["bbox"], size=[im.width, im.height]))
    over.save(os.path.join(outdir, "index.png"))
    json.dump(meta, open(os.path.join(outdir, "parts.json"), "w"), indent=1)
    print(json.dumps(meta))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
