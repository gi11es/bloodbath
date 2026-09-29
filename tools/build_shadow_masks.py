#!/usr/bin/env python3
"""Build soft, hole-free shadow atlases from the final character cutouts.

Each atlas part is processed independently so the blur cannot pick up an
unrelated sprite packed beside it. Run after rebuilding character atlases.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1] / 'public' / 'assets' / 'chars'


def softened(alpha):
    # Fill transparent details inside a piece of armour/cloth, and join tiny
    # breaks in the source cutout. The original sprite is never modified.
    solid = ndimage.binary_fill_holes(alpha > 22)
    solid = ndimage.binary_closing(np.pad(solid, 10), iterations=3)[10:-10, 10:-10]
    solid = ndimage.maximum_filter(solid, size=7)
    return np.uint8(np.clip(ndimage.gaussian_filter(solid.astype(np.float32), 12) * 255, 0, 255))


def build(name):
    im = Image.open(ROOT / f'{name}.webp').convert('RGBA')
    alpha = np.asarray(im)[..., 3]
    out = np.zeros_like(alpha)
    if name == 'drone':
        out = softened(alpha)
    else:
        parts = json.loads((ROOT / f'{name}.json').read_text())['parts']
        for part in parts.values():
            u, v, du, dv = part['uv']
            x0, x1 = round(u * im.width), round((u + du) * im.width)
            y0, y1 = round((1 - v - dv) * im.height), round((1 - v) * im.height)
            out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], softened(alpha[y0:y1, x0:x1]))
    Image.fromarray(out, 'L').save(ROOT / f'{name}_shadow.png', optimize=True)
    print(name, im.size, round(out.mean(), 2))


if __name__ == '__main__':
    for character in ['hero', 'grunt', 'leaper', 'butcher', 'boss', 'drone']:
        build(character)
