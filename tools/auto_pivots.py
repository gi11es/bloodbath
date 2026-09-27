#!/usr/bin/env python3
"""Auto-estimate joint points for part crops, draw overlays for review."""
import json, sys, os
import numpy as np
from PIL import Image, ImageDraw

LABELS = {
 "hero":   ["head","torso","upperarm","thigh","forearm","shin","weapon"],
 "grunt":  ["head","torso","upperarm","thigh","forearm","shin","weapon"],
 "butcher":["head","torso","upperarm","thigh","forearm","shield","shin","weapon"],
 "leaper": ["head","torso","upperarm","thigh","forearm","shin","weapon"],
 "boss":   ["head","torso","upperarm","tank","forearm","thigh","weapon","shin"],
}

def mask_of(p):
    a = np.array(Image.open(p))[..., 3]
    return a > 128

def row_center(m, y):
    xs = np.nonzero(m[y])[0]
    return (xs.min() + xs.max()) / 2 if len(xs) else m.shape[1] / 2

def col_center(m, x):
    ys = np.nonzero(m[:, x])[0]
    return (ys.min() + ys.max()) / 2 if len(ys) else m.shape[0] / 2

def estimate(label, m):
    h, w = m.shape
    ys, xs = np.nonzero(m)
    top, bot, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    pts = {}
    if label in ("upperarm", "thigh", "shin"):
        # vertical limb: joint inset from the top by ~ half the local width
        yt = int(top + (bot - top) * 0.02)
        wt = np.count_nonzero(m[min(bot, top + 20)])
        py = top + wt * 0.45
        pts["pivot"] = [row_center(m, int(min(bot, py))), float(py)]
        if label == "shin":
            # ankle: 80% down at the shaft's centre (use rows at 55% for shaft x)
            ay = top + (bot - top) * 0.78
            pts["end"] = [row_center(m, int(top + (bot - top) * 0.55)), float(ay)]
            pts["sole"] = [pts["end"][0], float(bot)]
        else:
            wb = np.count_nonzero(m[max(top, bot - 20)])
            ey = bot - wb * 0.45
            pts["end"] = [row_center(m, int(ey)), float(ey)]
    elif label == "forearm":
        # horizontal-ish: elbow at left, fist at right
        wl = np.count_nonzero(m[:, min(right, left + 20)])
        px = left + wl * 0.45
        pts["pivot"] = [float(px), col_center(m, int(px))]
        hx = right - (right - left) * 0.14
        pts["end"] = [float(hx), col_center(m, int(hx))]
    elif label == "head":
        pts["pivot"] = [row_center(m, int(bot - 8)), float(bot - (bot - top) * 0.1)]
        pts["top"] = [row_center(m, int(top + 4)), float(top)]
    elif label == "torso":
        pts["neck"] = [row_center(m, int(top + (bot - top) * 0.06)), float(top + (bot - top) * 0.06)]
        pts["shoulder"] = [row_center(m, int(top + (bot - top) * 0.2)), float(top + (bot - top) * 0.2)]
        pts["hip"] = [row_center(m, int(bot - (bot - top) * 0.1)), float(bot - (bot - top) * 0.1)]
        pts["pivot"] = pts["hip"]
    else:
        pts["pivot"] = [float(left + (right - left) * 0.3), float(top + (bot - top) * 0.6)]
        pts["end"] = [float(right), float(top + (bot - top) * 0.35)]
    return {k: [round(float(v[0]), 1), round(float(v[1]), 1)] for k, v in pts.items()}

def main(name):
    d = f"art_src/chars/{name}"
    out = {}
    tiles = []
    for i, label in enumerate(LABELS[name]):
        p = f"{d}/part_{i}.png"
        m = mask_of(p)
        pts = estimate(label, m)
        out[label] = dict(file=f"part_{i}.png", **pts)
        im = Image.open(p).convert("RGBA")
        bg = Image.new("RGBA", im.size, (40, 40, 60, 255))
        bg.alpha_composite(im)
        dr = ImageDraw.Draw(bg)
        for x in range(0, im.width, 20):
            dr.line([(x, 0), (x, im.height)], fill=(255, 255, 255, 40) if x % 100 else (255, 255, 0, 90))
        for y in range(0, im.height, 20):
            dr.line([(0, y), (im.width, y)], fill=(255, 255, 255, 40) if y % 100 else (255, 255, 0, 90))
        cols = {"pivot": (0, 255, 0), "end": (255, 0, 0), "sole": (0, 200, 255), "neck": (255, 255, 0), "shoulder": (0, 255, 255), "hip": (0, 255, 0), "top": (255, 0, 255)}
        for k, (x, y) in pts.items():
            dr.ellipse([x - 6, y - 6, x + 6, y + 6], outline=cols.get(k, (255, 255, 255)), width=3)
        dr.text((4, 4), f"{label} {im.size}", fill=(255, 255, 255))
        tiles.append(bg)
    json.dump(out, open(f"{d}/rig_auto.json", "w"), indent=1)
    W = sum(t.width for t in tiles) + 10 * len(tiles)
    H = max(t.height for t in tiles)
    sheet = Image.new("RGB", (W, H), (0, 0, 0))
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0)); x += t.width + 10
    sheet.save(f"/tmp/review_{name}.png")
    print(json.dumps(out))

main(sys.argv[1])
