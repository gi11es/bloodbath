#!/usr/bin/env python3
"""Repaint a weapon sprite with the character's hands gripping it, aligned to the original.
held_weapon.py <char> <part> "<hand description>" [grip description]"""
import sys, os, subprocess, json
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(__file__))
from extract_parts import key_magenta
import build_chars as B

char, part, hands = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = B.CHARS[char]["parts"][part]
src = cfg.get("src") or f"art_src/chars/{char}/{json.load(open(f'art_src/chars/{char}/rig_auto.json'))[part]['file']}"
wpn = Image.open(src).convert("RGBA")
S = 1024
scale = min(820 / wpn.width, 560 / wpn.height)
ww, wh = round(wpn.width * scale), round(wpn.height * scale)
ox, oy = (S - ww) // 2, (S - wh) // 2
canvas = Image.new("RGBA", (S, S), (255, 0, 255, 255))
canvas.alpha_composite(wpn.resize((ww, wh), Image.LANCZOS), (ox, oy))
ref = f"art_src/chars/held/{char}_{part}_ref.png"
canvas.convert("RGB").save(ref)
out = f"art_src/chars/held/{char}_{part}_raw.png"
sheet = f"art_src/chars/{char}_sheet.png"
if not os.path.exists(out):
    prompt = ("The FIRST attached image is a game sprite of a weapon on a flat magenta background. The SECOND image is the character sheet for reference of skin, gloves and painting style. "
              "Redraw the FIRST image EXACTLY: the same weapon, same size, same position on the canvas, same angle, same colours and hand-painted style, "
              "but now add the character's two hands gripping it, seen in strict side view: " + hands +
              ". Show ONLY the hands and wrists: each wrist ends in a short clean cut just behind the hand (no forearms, no arms, no body). "
              "The hands must be at the same scale as the reference character. Keep the flat pure magenta (#FF00FF) background everywhere else. No text.")
    env = dict(os.environ, REFS=f"{ref},{sheet}")
    subprocess.run(["python3", "tools/gen_image.py", out, prompt, "openai/gpt-5.4-image-2", "1:1"], check=True, env=env)
var = Image.open(out).convert("RGB").resize((S, S), Image.LANCZOS)
rgba = key_magenta(np.array(var))
a_var = rgba[..., 3]
a_ref = key_magenta(np.array(canvas.convert("RGB")))[..., 3]
best = (-1, 0, 0, 1.0)
for sc in [0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06]:
    z = ndimage.zoom(a_var, sc, order=1)
    zz = np.zeros((S, S), np.float32)
    h, w = z.shape
    if sc >= 1:
        y0, x0 = (h - S) // 2, (w - S) // 2; zz = z[y0:y0 + S, x0:x0 + S]
    else:
        y0, x0 = (S - h) // 2, (S - w) // 2; zz[y0:y0 + h, x0:x0 + w] = z
    for dy in range(-30, 31, 3):
        for dx in range(-30, 31, 3):
            sh = np.roll(np.roll(zz, dy, 0), dx, 1)
            cov = np.minimum(sh, a_ref).sum() / a_ref.sum() - 0.35 * np.clip(sh - a_ref, 0, 1).sum() / a_ref.sum()
            if cov > best[0]: best = (cov, dx, dy, sc)
cov, dx, dy, sc = best
img = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")
img = img.resize((round(S * sc), round(S * sc)), Image.LANCZOS)
full = Image.new("RGBA", (S, S))
full.paste(img, ((S - img.width) // 2 + dx, (S - img.height) // 2 + dy))
# express in the ORIGINAL weapon's pixel space, with padding so hands below/above are kept
pad = 90
crop = full.crop((ox - pad * scale, oy - pad * scale, ox + ww + pad * scale, oy + wh + pad * scale))
crop = crop.resize((wpn.width + 2 * pad, wpn.height + 2 * pad), Image.LANCZOS)
crop.save(f"art_src/chars/held/{char}_{part}.png")
print(json.dumps({"align": [float(cov), dx, dy, sc], "pad": pad, "size": crop.size}))
