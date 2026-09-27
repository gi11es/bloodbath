#!/usr/bin/env python3
"""Render part crops with labelled 50px grid for manual pivot picking. grid_view.py char out.png [labels...]"""
import sys, json
from PIL import Image, ImageDraw
name, out = sys.argv[1], sys.argv[2]
rig = json.load(open(f"art_src/chars/{name}/rig_auto.json"))
sel = sys.argv[3:] or list(rig)
tiles = []
for lab in sel:
    im = Image.open(f"art_src/chars/{name}/{rig[lab]['file']}").convert("RGBA")
    pad = 24
    bg = Image.new("RGBA", (im.width + pad, im.height + pad), (30, 30, 45, 255))
    bg.alpha_composite(im, (pad, pad))
    d = ImageDraw.Draw(bg)
    for x in range(0, im.width, 25):
        c = (255, 255, 0, 160) if x % 50 == 0 else (255, 255, 255, 50)
        d.line([(x + pad, pad), (x + pad, bg.height)], fill=c)
        if x % 50 == 0: d.text((x + pad - 6, 4), str(x), fill=(255, 255, 0))
    for y in range(0, im.height, 25):
        c = (255, 255, 0, 160) if y % 50 == 0 else (255, 255, 255, 50)
        d.line([(pad, y + pad), (bg.width, y + pad)], fill=c)
        if y % 50 == 0: d.text((2, y + pad - 5), str(y), fill=(255, 255, 0))
    d.text((pad + 4, pad + 4), lab, fill=(0, 255, 0))
    tiles.append(bg)
W = sum(t.width for t in tiles) + 8 * len(tiles); H = max(t.height for t in tiles)
s = Image.new("RGB", (W, H)); x = 0
for t in tiles: s.paste(t, (x, 0)); x += t.width + 8
s.save(out); print(s.size)
