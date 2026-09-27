#!/usr/bin/env python3
"""Repaint a torso part without the near shoulder/arm stub, aligned to the original crop.
torso_fix.py <char> "<what to remove>" """
import sys, os, subprocess, json
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(__file__))
from extract_parts import key_magenta
char, what = sys.argv[1], sys.argv[2]
src = json.load(open(f"art_src/chars/{char}/rig_auto.json"))["torso"]["file"]
tor = Image.open(f"art_src/chars/{char}/{src}").convert("RGBA")
S = 1024
sc = min(700 / tor.width, 820 / tor.height)
tw, th = round(tor.width * sc), round(tor.height * sc)
ox, oy = (S - tw) // 2, (S - th) // 2
canvas = Image.new("RGBA", (S, S), (255, 0, 255, 255))
canvas.alpha_composite(tor.resize((tw, th), Image.LANCZOS), (ox, oy))
os.makedirs("art_src/chars/torso_fix", exist_ok=True)
ref = f"art_src/chars/torso_fix/{char}_ref.png"; canvas.convert("RGB").save(ref)
out = f"art_src/chars/torso_fix/{char}_raw.png"
if not os.path.exists(out):
    prompt = ("This image is a game sprite of a character's TORSO for a 2D cutout-animation rig, strict side view facing right, on flat magenta. "
              "Redraw it EXACTLY: same size, same position on the canvas, same outline elsewhere, same colours, same hand-painted style and lighting. "
              "The ONLY change: " + what + ". The near arm is a separate sprite that will be attached at the shoulder, so the torso must show NO arm and NO shoulder pad "
              "on the near side: where they were, paint the torso's own clothing/armour continuing naturally (the side of the chest and the armhole area). "
              "Keep the flat pure magenta (#FF00FF) background. No text.")
    subprocess.run(["python3", "tools/gen_image.py", out, prompt, "openai/gpt-5.4-image-2", "1:1"], check=True, env=dict(os.environ, REFS=ref))
var = Image.open(out).convert("RGB").resize((S, S), Image.LANCZOS)
rgba = key_magenta(np.array(var))
a_var, a_ref = rgba[..., 3], key_magenta(np.array(canvas.convert("RGB")))[..., 3]
best = (-1, 0, 0, 1.0)
for s_ in [0.96, 0.98, 1.0, 1.02, 1.04]:
    z = ndimage.zoom(a_var, s_, order=1); zz = np.zeros((S, S), np.float32); h, w = z.shape
    if s_ >= 1: y0, x0 = (h - S) // 2, (w - S) // 2; zz = z[y0:y0 + S, x0:x0 + S]
    else: y0, x0 = (S - h) // 2, (S - w) // 2; zz[y0:y0 + h, x0:x0 + w] = z
    for dy in range(-30, 31, 3):
        for dx in range(-30, 31, 3):
            sh = np.roll(np.roll(zz, dy, 0), dx, 1)
            iou = np.minimum(sh, a_ref).sum() / np.maximum(sh, a_ref).sum()
            if iou > best[0]: best = (iou, dx, dy, s_)
iou, dx, dy, s_ = best
img = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA").resize((round(S * s_), round(S * s_)), Image.LANCZOS)
full = Image.new("RGBA", (S, S)); full.paste(img, ((S - img.width) // 2 + dx, (S - img.height) // 2 + dy))
crop = full.crop((ox, oy, ox + tw, oy + th)).resize(tor.size, Image.LANCZOS)
crop.save(f"art_src/chars/torso_fix/{char}.png")
prev = Image.new("RGBA", (tor.width * 2 + 10, tor.height), (40, 40, 60, 255)); prev.alpha_composite(tor, (0, 0)); prev.alpha_composite(crop, (tor.width + 10, 0))
prev.save(f"/tmp/torso_{char}.png"); print(char, "iou", round(float(iou), 3))
