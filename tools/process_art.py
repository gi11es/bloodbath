#!/usr/bin/env python3
"""Art processing helpers for Bloodbath.

Subcommands (all paths are files):
  key IN OUT [--rembg] [--lo 40] [--hi 140] [--minarea 400] [--erode 1] [--feather 0.8]
      Chroma-key a flat magenta (#FF00FF) background. It estimates the real key colour
      from the image border, computes a soft alpha, un-mixes the key colour from the edge
      pixels (despill), removes small islands, and feathers the edge.
  trim IN OUT [--pad 4]              Crop to the alpha bounding box.
  fit IN OUT WxH [--anchor bottom|center|top] [--mode cover|contain]
                                     Resize and crop (cover) or pad (contain) to WxH.
  seamx IN OUT [--overlap 0.12]      Make the image tile horizontally (min-cost seam cut
                                     and feather in an overlap zone; the width shrinks).
  seamxy IN OUT [--overlap 0.12]     The same in both directions.
  fade IN OUT --bottom A B           Fade the alpha to 0 between fractions A..B of the height.
  webp IN OUT [-q 90]                Export webp (keeps alpha if present).
  preview IN OUT [--nx 2] [--ny 1]   Tile the image and composite it on dark and light backgrounds.
"""
import argparse, sys
import numpy as np
from PIL import Image
from scipy import ndimage


# ---------------------------------------------------------------- io helpers
def load(path):
    return Image.open(path).convert("RGBA")


def arr(im):
    return np.asarray(im.convert("RGBA")).astype(np.float32) / 255.0


def img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def save_webp(im, out, q=90):
    im = im if isinstance(im, Image.Image) else img(im)
    a = np.asarray(im.convert("RGBA"))
    if a[..., 3].min() == 255:
        im.convert("RGB").save(out, "WEBP", quality=q, method=6)
    else:
        im.save(out, "WEBP", quality=q, method=6, exact=False, alpha_quality=100)


# ---------------------------------------------------------------- chroma key
def estimate_key(rgb):
    h, w, _ = rgb.shape
    b = max(2, min(h, w) // 100)
    border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
                             rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    mag = np.minimum(border[:, 0], border[:, 2]) - border[:, 1]
    sel = border[mag > 0.45]
    if len(sel) < 50:
        return np.array([1.0, 0.0, 1.0], np.float32)
    return np.median(sel, axis=0).astype(np.float32)


def chroma_key(im, lo=40, hi=140, minarea=400, erode=1, feather=0.8, keep_holes=True, warm="semi"):
    a = arr(im)
    rgb = a[..., :3]
    key = estimate_key(rgb)
    # "magenta-ness": how much both R and B exceed G. Pure key ~ 1, crimson or skin ~ small.
    m = (np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]) * 255.0
    km = (min(key[0], key[2]) - key[1]) * 255.0
    lo_, hi_ = lo * km / 255.0, hi * km / 255.0
    alpha = 1.0 - np.clip((m - lo_) / max(1e-3, hi_ - lo_), 0, 1)
    # Also require closeness in hue: a pixel far from the key colour in RGB stays opaque.
    dist = np.linalg.norm(rgb - key[None, None, :], axis=-1)
    alpha = np.maximum(alpha, np.clip((dist - 0.55) / 0.25, 0, 1))

    # Remove small islands (noise specks in the background) and tiny holes.
    solid = alpha > 0.5
    lab, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        small = np.isin(lab, np.nonzero(sizes < minarea)[0] + 1)
        alpha[small] = 0
    if not keep_holes:
        holes = ndimage.binary_fill_holes(alpha > 0.5) & (alpha <= 0.5)
        alpha[holes] = 1

    if erode > 0:
        alpha = ndimage.grey_erosion(alpha, size=(2 * erode + 1, 2 * erode + 1))
    if feather > 0:
        alpha = ndimage.gaussian_filter(alpha, feather)
        alpha = np.clip((alpha - 0.08) / 0.92, 0, 1)

    # Despill: un-mix the key colour from partially transparent pixels, then neutralise
    # remaining magenta cast near the edge.
    ae = np.clip(alpha, 0.05, 1)[..., None]
    un = (rgb - (1 - ae) * key[None, None, :]) / ae
    un = np.clip(un, 0, 1)
    edge = ndimage.binary_dilation(alpha < 0.98, iterations=6)
    out = rgb.copy()
    w = np.clip(1 - alpha, 0, 1)[..., None]
    out = np.where(edge[..., None], un * w + rgb * (1 - w), rgb)
    spill = np.clip(np.minimum(out[..., 0], out[..., 2]) - out[..., 1], 0, 1)
    sm = np.where(edge, spill, 0)
    # Only remove the cast where it looks like the key (both R and B raised).
    out[..., 0] -= sm * 0.85
    out[..., 2] -= sm * 0.85
    if warm:
        # warm="semi": fix semi-transparent pixels only; warm="all": also remove the pink/purple cast
        # that the key colour induces in opaque paint (use for warm-palette background layers).
        semi = (alpha < 0.95)[..., None]
        r, g, b = out[..., 0], out[..., 1], out[..., 2]
        b2 = np.minimum(b, np.maximum(g, 0.35 * r))
        g2 = np.minimum(g, np.maximum(r, b2))
        fixed = np.dstack([r, g2, b2])
        out = np.where(semi, fixed, out)
        if warm == "all":
            out = np.dstack([out[..., 0], out[..., 1], np.minimum(out[..., 2], np.maximum(out[..., 1] + 0.03, 0.35 * out[..., 0]))])
    alpha = alpha * a[..., 3]          # respect an alpha that is already present
    res = np.dstack([np.clip(out, 0, 1), alpha])
    res[..., :3] *= (alpha[..., None] > 0)
    return img(res)


def rembg_key(im):
    from rembg import remove
    return remove(im.convert("RGB")).convert("RGBA")


# ---------------------------------------------------------------- geometry
def trim(im, pad=4, thr=8):
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > thr)
    if len(xs) == 0:
        return im
    x0, x1 = max(0, xs.min() - pad), min(im.width, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(im.height, ys.max() + 1 + pad)
    return im.crop((x0, y0, x1, y1))


def fit(im, w, h, anchor="bottom", mode="cover"):
    sw, sh = im.size
    s = max(w / sw, h / sh) if mode == "cover" else min(w / sw, h / sh)
    nw, nh = max(1, round(sw * s)), max(1, round(sh * s))
    r = im.resize((nw, nh), Image.LANCZOS)
    if mode == "cover":
        x0 = (nw - w) // 2
        y0 = {"bottom": nh - h, "top": 0}.get(anchor, (nh - h) // 2)
        return r.crop((x0, y0, x0 + w, y0 + h))
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y0 = {"bottom": h - nh, "top": 0}.get(anchor, (h - nh) // 2)
    canvas.paste(r, ((w - nw) // 2, y0))
    return canvas


def _seam_path(cost):
    """Min-cost top-to-bottom path through cost (H x W). Returns x per row."""
    h, w = cost.shape
    acc = cost.copy()
    for y in range(1, h):
        prev = acc[y - 1]
        l = np.r_[np.inf, prev[:-1]]
        r = np.r_[prev[1:], np.inf]
        acc[y] += np.minimum(np.minimum(l, prev), r)
    path = np.zeros(h, np.int32)
    path[-1] = int(np.argmin(acc[-1]))
    for y in range(h - 2, -1, -1):
        x = path[y + 1]
        lo, hi = max(0, x - 1), min(w, x + 2)
        path[y] = lo + int(np.argmin(acc[y, lo:hi]))
    return path


def merge_zone(A, B, feather=12):
    """Merge two overlapping RGBA zones (float arrays, same shape) along a min-cost vertical seam.
    Column 0 of the result equals A, the last column equals B."""
    h, ov, _ = A.shape
    pa = np.dstack([A[..., :3] * A[..., 3:], A[..., 3:]])
    pb = np.dstack([B[..., :3] * B[..., 3:], B[..., 3:]])
    diff = ndimage.gaussian_filter(np.abs(pa - pb).sum(-1), 1.5)
    xs = np.arange(ov)
    # Keep the seam away from the zone borders so the feather has room.
    diff += (np.abs(xs - ov / 2) / (ov / 2))[None, :] ** 4 * (diff.mean() + 1e-3) * 4
    step = max(1, h // 700)
    path = _seam_path(diff[::step])
    path = np.repeat(path, step)[:h]
    if len(path) < h:
        path = np.r_[path, np.full(h - len(path), path[-1])]
    path = ndimage.uniform_filter1d(path.astype(np.float32), 9)
    t = np.clip((xs[None, :] - path[:, None]) / feather + 0.5, 0, 1)[..., None]
    pm = pa * (1 - t) + pb * t
    al = pm[..., 3:]
    col = np.where(al > 1e-4, pm[..., :3] / np.maximum(al, 1e-4), 0)
    return np.dstack([col, al])


def seam_x(im, overlap=0.12, feather=12):
    """Make an image tile horizontally: the right end zone is merged into the left start zone
    along a min-cost seam, then the right end zone is removed (the width shrinks by the overlap)."""
    a = arr(im)
    h, w, _ = a.shape
    ov = max(16, int(w * overlap))
    out = a[:, : w - ov].copy()
    out[:, :ov] = merge_zone(a[:, w - ov:], a[:, :ov], feather)
    return img(out)


def join_x(left, right, overlap=0.12, feather=12):
    """Join two images side by side along a min-cost seam in an overlap zone."""
    if right.height != left.height:
        right = right.resize((round(right.width * left.height / right.height), left.height), Image.LANCZOS)
    a, b = arr(left), arr(right)
    ov = max(16, int(min(a.shape[1], b.shape[1]) * overlap))
    merged = merge_zone(a[:, -ov:], b[:, :ov], feather)
    return img(np.concatenate([a[:, :-ov], merged, b[:, ov:]], axis=1))


def surface_line(im, frac=0.7, thr=128):
    """First row (from the top) where at least `frac` of the columns are opaque."""
    a = np.asarray(im)[..., 3] > thr
    cov = a.mean(axis=1)
    idx = np.nonzero(cov >= frac)[0]
    return int(idx[0]) if len(idx) else None


def seam_xy(im, overlap=0.12, feather=12):
    im = seam_x(im, overlap, feather)
    im = seam_x(im.transpose(Image.Transpose.ROTATE_90), overlap, feather).transpose(Image.Transpose.ROTATE_270)
    return im


def fade_bottom(im, a0, a1):
    a = arr(im)
    h = a.shape[0]
    y = np.arange(h) / h
    f = 1 - np.clip((y - a0) / max(1e-4, a1 - a0), 0, 1)
    f = f * f * (3 - 2 * f)
    a[..., 3] *= f[:, None]
    return img(a)


def fade_top(im, a0, a1):
    a = arr(im)
    h = a.shape[0]
    y = np.arange(h) / h
    f = np.clip((y - a0) / max(1e-4, a1 - a0), 0, 1)
    f = f * f * (3 - 2 * f)
    a[..., 3] *= f[:, None]
    return img(a)


def preview(im, nx=2, ny=1, maxw=2400):
    tile = Image.new("RGBA", (im.width * nx, im.height * ny))
    for i in range(nx):
        for j in range(ny):
            tile.paste(im, (i * im.width, j * im.height))
    s = min(1.0, maxw / tile.width)
    tile = tile.resize((max(1, int(tile.width * s)), max(1, int(tile.height * s))), Image.LANCZOS)
    rows = []
    for bg in [(20, 18, 24, 255), (235, 235, 230, 255)]:
        c = Image.new("RGBA", tile.size, bg)
        c.alpha_composite(tile)
        rows.append(c)
    out = Image.new("RGBA", (tile.width, tile.height * 2 + 8), (255, 0, 0, 255))
    out.paste(rows[0], (0, 0))
    out.paste(rows[1], (0, tile.height + 8))
    return out.convert("RGB")


# ---------------------------------------------------------------- cli
def main():
    p = argparse.ArgumentParser()
    sp = p.add_subparsers(dest="cmd", required=True)
    k = sp.add_parser("key"); k.add_argument("i"); k.add_argument("o")
    k.add_argument("--rembg", action="store_true"); k.add_argument("--lo", type=float, default=40)
    k.add_argument("--hi", type=float, default=140); k.add_argument("--minarea", type=int, default=400)
    k.add_argument("--erode", type=int, default=1); k.add_argument("--feather", type=float, default=0.8)
    t = sp.add_parser("trim"); t.add_argument("i"); t.add_argument("o"); t.add_argument("--pad", type=int, default=4)
    f = sp.add_parser("fit"); f.add_argument("i"); f.add_argument("o"); f.add_argument("size")
    f.add_argument("--anchor", default="bottom"); f.add_argument("--mode", default="cover")
    for name in ("seamx", "seamxy"):
        s = sp.add_parser(name); s.add_argument("i"); s.add_argument("o"); s.add_argument("--overlap", type=float, default=0.12)
    fd = sp.add_parser("fade"); fd.add_argument("i"); fd.add_argument("o"); fd.add_argument("--bottom", nargs=2, type=float)
    w = sp.add_parser("webp"); w.add_argument("i"); w.add_argument("o"); w.add_argument("-q", type=int, default=90)
    pv = sp.add_parser("preview"); pv.add_argument("i"); pv.add_argument("o")
    pv.add_argument("--nx", type=int, default=2); pv.add_argument("--ny", type=int, default=1)
    a = p.parse_args()

    im = load(a.i)
    if a.cmd == "key":
        out = rembg_key(im) if a.rembg else chroma_key(im, a.lo, a.hi, a.minarea, a.erode, a.feather)
    elif a.cmd == "trim":
        out = trim(im, a.pad)
    elif a.cmd == "fit":
        W, H = map(int, a.size.lower().split("x"))
        out = fit(im, W, H, a.anchor, a.mode)
    elif a.cmd == "seamx":
        out = seam_x(im, a.overlap)
    elif a.cmd == "seamxy":
        out = seam_xy(im, a.overlap)
    elif a.cmd == "fade":
        out = fade_bottom(im, *a.bottom)
    elif a.cmd == "webp":
        return save_webp(im, a.o, a.q)
    elif a.cmd == "preview":
        return preview(im, a.nx, a.ny).save(a.o)
    if a.o.lower().endswith(".webp"):
        save_webp(out, a.o)
    else:
        out.save(a.o)


if __name__ == "__main__":
    main()
