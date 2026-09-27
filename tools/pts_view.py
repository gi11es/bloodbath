#!/usr/bin/env python3
"""Show part crops with their configured joint points. pts_view.py char out.png part1 part2 ..."""
import sys, json, copy
sys.argv, args = sys.argv[:1], sys.argv[1:]
import build_chars as B
from PIL import Image, ImageDraw
name, out, parts = args[0], args[1], args[2:]
cfg = copy.deepcopy(B.CHARS[name])
src = json.load(open(f"art_src/chars/{name}/rig_auto.json"))
der = B.split_limbs(name, cfg, src)
tiles = []
for lab in parts:
    pts = cfg["parts"].get(lab) or der[lab][1]
    if lab in der: im = der[lab][0]; pts = der[lab][1]
    else: im = Image.open(pts.get("src") or f"art_src/chars/{name}/{src[lab]['file']}").convert("RGBA")
    k = 2 if max(im.size) < 400 else 1
    im = im.resize((im.width * k, im.height * k))
    bg = Image.new("RGBA", (im.width + 40, im.height + 40), (35, 35, 50, 255)); bg.alpha_composite(im, (20, 20))
    d = ImageDraw.Draw(bg)
    for x in range(0, im.width // k, 25):
        d.line([(20 + x * k, 20), (20 + x * k, 20 + im.height)], fill=(255, 255, 0, 110) if x % 50 == 0 else (255, 255, 255, 35))
        if x % 50 == 0: d.text((16 + x * k, 4), str(x), fill=(255, 255, 0))
    for y in range(0, im.height // k, 25):
        d.line([(20, 20 + y * k), (20 + im.width, 20 + y * k)], fill=(255, 255, 0, 110) if y % 50 == 0 else (255, 255, 255, 35))
        if y % 50 == 0: d.text((2, 16 + y * k), str(y), fill=(255, 255, 0))
    cols = {"pivot": (0, 255, 0), "end": (255, 40, 40), "fore": (0, 200, 255), "muzzle": (255, 0, 255), "stock": (255, 160, 0), "neck": (255, 255, 0), "shoulder": (0, 255, 255), "hip": (0, 255, 0), "top": (255, 0, 255), "sole": (0, 200, 255), "heel": (255, 160, 0), "tip": (255, 255, 255)}
    for key, v in pts.items():
        if not (isinstance(v, (tuple, list)) and len(v) == 2): continue
        x, y = 20 + v[0] * k, 20 + v[1] * k
        c = cols.get(key, (255, 255, 255))
        d.ellipse([x - 7, y - 7, x + 7, y + 7], outline=c, width=3)
        d.text((x + 9, y - 6), key, fill=c)
    d.text((24, 24), lab, fill=(0, 255, 0))
    tiles.append(bg)
W = sum(t.width for t in tiles) + 10 * len(tiles); H = max(t.height for t in tiles)
o = Image.new("RGB", (W, H)); x = 0
for t in tiles: o.paste(t, (x, 0)); x += t.width + 10
o.save(out); print(o.size)
