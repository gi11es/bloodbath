#!/usr/bin/env python3
"""Generate facial-expression variants of a head sprite and align them to the original crop.
Usage: face_variants.py <char> <name> "<expression prompt>" """
import sys, os, subprocess, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from extract_parts import key_magenta

char, name, expr = sys.argv[1], sys.argv[2], sys.argv[3]
src = f"art_src/chars/{char}/part_0.png" if char != "boss" else "art_src/chars/boss/part_0.png"
head = Image.open(src).convert("RGBA")
S = 1024
scale = min(700 / head.width, 700 / head.height)
hw, hh = round(head.width * scale), round(head.height * scale)
ox, oy = (S - hw) // 2, (S - hh) // 2
canvas = Image.new("RGBA", (S, S), (255, 0, 255, 255))
canvas.alpha_composite(head.resize((hw, hh), Image.LANCZOS), (ox, oy))
ref = f"art_src/chars/faces/{char}_ref.png"
canvas.convert("RGB").save(ref)
out = f"art_src/chars/faces/{char}_{name}_raw.png"
if not os.path.exists(out):
    prompt = ("This image is a game sprite of a character's head on a flat pure magenta background. "
              "Reproduce the EXACT same sprite: identical framing, identical size and position on the canvas, identical head angle, "
              "identical hair, headwear, lighting, colours and hand-painted style. Change ONLY the facial expression: " + expr +
              ". Keep the flat pure magenta (#FF00FF) background everywhere else. No text, no extra objects.")
    env = dict(os.environ, REFS=ref)
    subprocess.run(["python3", "tools/gen_image.py", out, prompt, "openai/gpt-5.4-image-2", "1:1"], check=True, env=env)
var = Image.open(out).convert("RGB").resize((S, S), Image.LANCZOS)
rgba = key_magenta(np.array(var))
a_var = rgba[..., 3]
a_ref = key_magenta(np.array(canvas.convert("RGB")))[..., 3]
# align: search small translation/scale maximising alpha IoU
best = (-1, 0, 0, 1.0)
from scipy import ndimage
for sc in [0.96, 0.98, 1.0, 1.02, 1.04]:
    z = ndimage.zoom(a_var, sc, order=1)
    # centre crop / pad back to S
    zz = np.zeros((S, S), np.float32)
    h, w = z.shape
    y0, x0 = (h - S) // 2, (w - S) // 2
    if sc >= 1: zz = z[y0:y0 + S, x0:x0 + S]
    else: zz[-y0:-y0 + h, -x0:-x0 + w] = z
    for dy in range(-24, 25, 3):
        for dx in range(-24, 25, 3):
            sh = np.roll(np.roll(zz, dy, 0), dx, 1)
            inter = np.minimum(sh, a_ref).sum(); uni = np.maximum(sh, a_ref).sum()
            iou = inter / max(uni, 1)
            if iou > best[0]: best = (iou, dx, dy, sc)
iou, dx, dy, sc = best
print("align", best)
img = Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")
img = img.resize((round(S * sc), round(S * sc)), Image.LANCZOS)
full = Image.new("RGBA", (S, S))
full.paste(img, ((S - img.width) // 2 + dx, (S - img.height) // 2 + dy))
crop = full.crop((ox, oy, ox + hw, oy + hh)).resize(head.size, Image.LANCZOS)
# keep the original silhouette outside the face region soft-limited to avoid halos
crop.save(f"art_src/chars/faces/{char}_{name}.png")
# preview
prev = Image.new("RGBA", (head.width * 2 + 10, head.height), (40, 40, 60, 255))
prev.alpha_composite(head, (0, 0)); prev.alpha_composite(crop, (head.width + 10, 0))
prev.save(f"/tmp/face_{char}_{name}.png")
print("iou", round(iou, 3))
