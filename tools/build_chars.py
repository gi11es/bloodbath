#!/usr/bin/env python3
"""Build character atlases (color + normal) and rig json from extracted parts + manual joints."""
import json, math
import numpy as np
from PIL import Image
from scipy import ndimage

# Manual joint points in part-crop pixels. 'pivot' = joint to parent, 'end' = child joint.
SPLIT = {'hero': {'wrist': (135, 122), 'grip': (190, 163), 'cut': 222, 'ankle': (85, 232), 'toe': (222, 292), 'heel': (40, 300), 'sole': 305}, 'grunt': {'wrist': (168, 100), 'grip': (215, 112), 'cut': 213, 'ankle': (70, 222), 'toe': (180, 258), 'heel': (30, 262), 'sole': 272}, 'leaper': {'wrist': (148, 125), 'grip': (180, 152), 'cut': 238, 'ankle': (72, 248), 'toe': (178, 282), 'heel': (35, 286), 'sole': 292}, 'butcher': {'wrist': (192, 112), 'grip': (238, 125), 'cut': 203, 'ankle': (80, 212), 'toe': (205, 242), 'heel': (35, 250), 'sole': 262}, 'boss': {'wrist': (92, 78), 'grip': (130, 112), 'cut': 248, 'ankle': (70, 258), 'toe': (170, 292), 'heel': (25, 300), 'sole': 305}}

CHARS = {
 "hero": dict(height=1.8, res=0.6, parts={
   "head": dict(pivot=(214, 192), top=(230, 8)),
   "head_blink": dict(src="art_src/chars/faces/hero_blink.png", pivot=(214, 192), top=(230, 8)),
   "head_shout": dict(src="art_src/chars/faces/hero_shout.png", pivot=(214, 192), top=(230, 8)),
   "head_hurt": dict(src="art_src/chars/faces/hero_hurt.png", pivot=(214, 192), top=(230, 8)),
   "torso": dict(src="art_src/chars/torso_fix/hero.png", pivot=(150, 370), neck=(160, 40), shoulder=(100, 118), hip=(150, 370)),
   "upperarm": dict(pivot=(95, 82), end=(112, 300)),
   "forearm": dict(pivot=(64, 70), end=(195, 165), trim=True),
   "thigh": dict(pivot=(90, 40), end=(95, 290)),
   "shin": dict(pivot=(65, 40), end=(85, 250), sole=(85, 300)),
   "weapon": dict(pivot=(172, 152), fore=(362, 122), muzzle=(612, 98), stock=(40, 110)),
   "machete": dict(src="art_src/chars/weapons/part_0.png", pivot=(91, 47), muzzle=(626, 35), scale=0.583),
   "hmg": dict(src="art_src/chars/weapons/part_1.png", pivot=(219, 144), fore=(509, 109), muzzle=(809, 86), stock=(19, 104), scale=0.913),
   "shotgun": dict(src="art_src/chars/weapons/part_2.png", pivot=(240, 74), fore=(515, 56), muzzle=(707, 31), stock=(20, 89), scale=0.878),
   "ripper": dict(src="art_src/chars/weapons/part_3.png", pivot=(145, 145), fore=(380, 145), muzzle=(475, 105), stock=(20, 125), scale=1.17),
   "disc": dict(src="art_src/chars/weapons/part_4.png", pivot=(76, 72), scale=1.25),
   "grenade": dict(src="art_src/chars/weapons/part_5.png", pivot=(50, 66), scale=0.72),
   # weapons repainted with the gripping hands baked in; pivot = rear wrist, wristB = front wrist
   "weapon_held": dict(src="art_src/chars/held/hero_weapon.png", pivot=(155, 305), cuff=(185, 290), wristB=(450, 290), cuffB=(480, 272), muzzle=(700, 165), stock=(110, 190), scale=0.88),
   "hmg_held": dict(src="art_src/chars/held/hero_hmg.png", pivot=(205, 285), cuff=(255, 265), wristB=(518, 270), cuffB=(550, 255), muzzle=(905, 167), stock=(100, 185), scale=0.82),
   "shotgun_held": dict(src="art_src/chars/held/hero_shotgun.png", pivot=(210, 215), cuff=(235, 185), wristB=(545, 195), cuffB=(570, 175), muzzle=(785, 115), stock=(105, 160), scale=0.79),
   "ripper_held": dict(src="art_src/chars/held/hero_ripper.png", pivot=(90, 290), cuff=(140, 265), wristB=(380, 295), cuffB=(410, 275), muzzle=(560, 185), stock=(95, 200), scale=1.05),
 }),
 "grunt": dict(height=1.8, res=0.6, parts={
   "head": dict(pivot=(98, 172), top=(80, 8)),
   "torso": dict(src="art_src/chars/torso_fix/grunt.png", pivot=(140, 350), neck=(158, 58), shoulder=(180, 88), hip=(140, 350)),
   "upperarm": dict(pivot=(55, 52), end=(55, 222), clip=250),
   "forearm": dict(pivot=(35, 65), end=(215, 110)),
   "thigh": dict(pivot=(80, 40), end=(85, 240)),
   "shin": dict(pivot=(45, 35), end=(70, 215), sole=(70, 268)),
   "weapon": dict(pivot=(210, 140), fore=(400, 110), muzzle=(620, 88), stock=(20, 90)),
   "shotgun": dict(src="art_src/chars/lweapons/part_0.png", pivot=(142, 112), fore=(377, 87), muzzle=(477, 59), stock=(17, 72)),
   "launcher": dict(src="art_src/chars/lweapons/part_1.png", pivot=(134, 116), fore=(454, 106), muzzle=(556, 81), stock=(14, 96)),
   "sniper": dict(src="art_src/chars/lweapons/part_2.png", pivot=(183, 161), fore=(593, 113), muzzle=(915, 93), stock=(13, 116), scale=0.82),
   "flamer": dict(src="art_src/chars/lweapons/part_3.png", pivot=(91, 105), fore=(331, 95), muzzle=(601, 72), stock=(16, 75)),
   "shotgun_held": dict(src="art_src/chars/held/grunt_shotgun.png", pivot=(212, 246), wristB=(418, 248), muzzle=(570, 160), stock=(115, 190), scale=0.9),
   "launcher_held": dict(src="art_src/chars/held/grunt_launcher.png", pivot=(190, 252), wristB=(482, 256), muzzle=(650, 180), stock=(105, 200), scale=0.9),
   "sniper_held": dict(src="art_src/chars/held/grunt_sniper.png", pivot=(200, 288), wristB=(468, 286), muzzle=(1000, 178), stock=(105, 215), scale=0.75),
   "flamer_held": dict(src="art_src/chars/held/grunt_flamer.png", pivot=(122, 266), wristB=(410, 272), muzzle=(705, 165), stock=(105, 165), scale=0.9),
   "weapon_held": dict(src="art_src/chars/held/grunt_weapon.png", pivot=(210, 260), cuff=(225, 250), wristB=(470, 275), cuffB=(485, 265), muzzle=(710, 165), stock=(105, 200), scale=0.9),
 }),
 "leaper": dict(height=1.85, res=0.6, parts={
   "head": dict(pivot=(182, 188), top=(170, 8)),
   "torso": dict(src="art_src/chars/torso_fix/leaper.png", pivot=(85, 300), neck=(90, 35), shoulder=(70, 110), hip=(85, 300)),
   "upperarm": dict(pivot=(55, 40), end=(55, 150), clip=175),
   "forearm": dict(pivot=(35, 45), end=(175, 150)),
   "thigh": dict(pivot=(100, 70), end=(110, 370)),
   "shin": dict(pivot=(65, 40), end=(80, 240), sole=(80, 290)),
   "weapon": dict(pivot=(230, 55), muzzle=(960, 60)),
 }),
 "butcher": dict(height=2.5, res=0.6, parts={
   "head": dict(pivot=(112, 170), top=(100, 10)),
   "torso": dict(pivot=(210, 400), neck=(190, 60), shoulder=(270, 170), hip=(210, 400)),
   "upperarm": dict(pivot=(80, 60), end=(100, 230)),
   "forearm": dict(pivot=(40, 90), end=(225, 120)),
   "thigh": dict(pivot=(90, 50), end=(100, 250)),
   "shin": dict(pivot=(65, 30), end=(80, 180), sole=(80, 255)),
   "weapon": dict(pivot=(110, 70), muzzle=(450, 130)),
   "shield": dict(pivot=(125, 225)),
 }),
 "boss": dict(height=5.2, res=1.0, parts={
   "head": dict(pivot=(150, 200), top=(150, 20)),
   "head_roar": dict(src="art_src/chars/faces/boss_roar.png", pivot=(150, 200), top=(150, 20)),
   "torso": dict(src="art_src/chars/torso_fix/boss.png", pivot=(130, 330), neck=(140, 100), shoulder=(60, 200), hip=(130, 330)),
   "upperarm": dict(pivot=(60, 90), end=(65, 230)),
   "forearm": dict(pivot=(35, 45), end=(135, 110)),
   "thigh": dict(pivot=(65, 40), end=(70, 260)),
   "shin": dict(pivot=(55, 40), end=(70, 250), sole=(70, 300)),
   "weapon": dict(pivot=(270, 200), fore=(380, 165), muzzle=(490, 112)),
   "weapon_held": dict(src="art_src/chars/held/boss_weapon.png", pivot=(65, 300), cuff=(110, 290), wristB=(370, 365), cuffB=(380, 340), muzzle=(570, 200), stock=(90, 195), scale=0.95),
   "tank": dict(pivot=(125, 260)),
 }),
}

def normal_map(rgba, scale):
    a = rgba[..., 3].astype(np.float32) / 255.0
    lum = (rgba[..., :3].astype(np.float32) / 255.0) @ np.array([0.3, 0.59, 0.11], np.float32)
    dist = ndimage.distance_transform_edt(a > 0.5)
    bevel = max(3.0, 16.0 * scale)
    h = np.clip(dist / bevel, 0, 1)
    h = np.sin(h * math.pi / 2)  # rounded bevel
    detail = ndimage.gaussian_filter(lum, 1.0) * 0.35
    h = ndimage.gaussian_filter(h, 1.2) + detail
    gy, gx = np.gradient(h)
    k = 3.0
    nx, ny, nz = -gx * k, gy * k, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.dstack([nx / l, ny / l, nz / l]) * 0.5 + 0.5
    out = np.dstack([(n * 255).astype(np.uint8), rgba[..., 3]])
    return out

def pack(rects, width=2048):
    # rects: list of (key, w, h); shelf packing
    order = sorted(rects, key=lambda r: -r[2])
    x = y = shelf = 0
    pos = {}
    for key, w, h in order:
        if x + w > width:
            x, y, shelf = 0, y + shelf + 2, 0
        pos[key] = (x, y)
        x += w + 2
        shelf = max(shelf, h)
    return pos, y + shelf

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def split_limbs(name, cfg, src):
    """Cut hands off forearms and feet off shins. Returns {label: (PIL image, points)}."""
    sp = SPLIT[name]
    P = cfg["parts"]
    out = {}
    ov = 9.0
    # forearm / hand
    fa = np.array(Image.open(f"art_src/chars/{name}/{src['forearm']['file']}").convert("RGBA")).astype(np.float32)
    E = np.array(P["forearm"]["pivot"], np.float32); F = np.array(P["forearm"]["end"], np.float32)
    W = np.array(sp["wrist"], np.float32); G = np.array(sp["grip"], np.float32)
    u = (F - E) / np.linalg.norm(F - E)
    yy, xx = np.mgrid[0:fa.shape[0], 0:fa.shape[1]].astype(np.float32)
    sdist = (xx - W[0]) * u[0] + (yy - W[1]) * u[1]
    fore = fa.copy(); fore[..., 3] *= 1 - smooth(-ov * 0.3, ov, sdist)
    if P["forearm"].get("trim"):
        # drop the painted sleeve stub behind the elbow pivot
        back = (xx - E[0]) * u[0] + (yy - E[1]) * u[1]
        fore[..., 3] *= smooth(-14, 2, back)
    hand = fa.copy(); hand[..., 3] *= smooth(-ov * 1.6, -ov * 0.8, sdist)
    out["forearm"] = (Image.fromarray(fore.astype(np.uint8)), dict(pivot=tuple(E), end=tuple(W)))
    out["hand"] = (Image.fromarray(hand.astype(np.uint8)), dict(pivot=tuple(W), end=tuple(G), tip=tuple(F)))
    # shin / foot
    sh = np.array(Image.open(f"art_src/chars/{name}/{src['shin']['file']}").convert("RGBA")).astype(np.float32)
    yy = np.mgrid[0:sh.shape[0], 0:sh.shape[1]][0].astype(np.float32)
    c = sp["cut"]
    shin = sh.copy(); shin[..., 3] *= 1 - smooth(c - ov * 0.3, c + ov, yy)
    foot = sh.copy(); foot[..., 3] *= smooth(c - ov * 1.6, c - ov * 0.8, yy)
    K = P["shin"]["pivot"]; A = sp["ankle"]
    out["shin"] = (Image.fromarray(shin.astype(np.uint8)), dict(pivot=tuple(K), end=tuple(A)))
    out["foot"] = (Image.fromarray(foot.astype(np.uint8)), dict(pivot=tuple(A), end=tuple(sp["toe"]), heel=tuple(sp["heel"]), sole=(A[0], sp["sole"])))
    return out

# target bone lengths as a fraction of body height (human proportions, slightly heroic)
TARGET = {"upperarm": 0.185, "forearm": 0.15, "thigh": 0.245, "shin": 0.235}

def stretch_part(im, pts, factor):
    """Stretch an RGBA image along its bone (pivot->end) by factor, keeping thickness. Returns (im, pts)."""
    P = np.array(pts["pivot"], np.float64); E = np.array(pts["end"], np.float64)
    u = (E - P) / np.linalg.norm(E - P); v = np.array([-u[1], u[0]])
    R = np.stack([u, v], 1)  # columns
    M = R @ np.diag([factor, 1.0]) @ R.T
    fwd = lambda q: P + M @ (np.asarray(q, np.float64) - P)
    corners = np.array([fwd(c) for c in [(0, 0), (im.width, 0), (0, im.height), (im.width, im.height)]])
    x0, y0 = np.floor(corners.min(0)); x1, y1 = np.ceil(corners.max(0))
    W, H = int(x1 - x0), int(y1 - y0)
    Mi = np.linalg.inv(M)
    # output (x', y') -> input: p = P + Mi (p' + off - P)
    off = np.array([x0, y0])
    a, b, c, d = Mi[0, 0], Mi[0, 1], Mi[1, 0], Mi[1, 1]
    t = P - Mi @ (P - off)
    out = im.transform((W, H), Image.AFFINE, (a, b, t[0], c, d, t[1]), resample=Image.BICUBIC)
    npts = {}
    for k, q in pts.items():
        if isinstance(q, (tuple, list)) and len(q) == 2:
            r = fwd(q) - off
            npts[k] = (float(r[0]), float(r[1]))
        else:
            npts[k] = q
    return out, npts

def build(name, cfg):
    src = json.load(open(f"art_src/chars/{name}/rig_auto.json"))
    res = cfg["res"]
    imgs = {}
    derived = split_limbs(name, cfg, src)
    P0 = cfg["parts"]
    fixed_px = math.dist(P0["head"]["pivot"], P0["head"]["top"]) + math.dist(P0["torso"]["neck"], P0["torso"]["hip"]) + abs(derived["foot"][1]["sole"][1] - derived["foot"][1]["pivot"][1])
    cfg["_mpp"] = cfg["height"] * (1 - TARGET["thigh"] - TARGET["shin"]) / fixed_px
    for lab, (im, pts) in derived.items():
        cfg["parts"][lab] = {**pts, "_img": im}
    for lab, pts in cfg["parts"].items():
        if "_img" in pts: im = pts["_img"]
        else:
            path = pts.get("src") or f"art_src/chars/{name}/{src[lab]['file']}"
            im = Image.open(path).convert("RGBA")
        k = pts.get("scale", 1.0)
        if "clip" in pts:
            arr = np.array(im)
            c = pts["clip"]
            fade = np.clip((c - np.arange(arr.shape[0])) / 12.0, 0, 1)
            arr[..., 3] = (arr[..., 3] * fade[:, None]).astype(np.uint8)
            im = Image.fromarray(arr[: c + 2])
            pts = {kk: vv for kk, vv in pts.items() if kk != "clip"}
            cfg["parts"][lab] = pts
        if lab in TARGET and not pts.get("noStretch"):
            cur = math.dist(pts["pivot"], pts["end"])
            want = TARGET[lab] * cfg["height"] / cfg["_mpp"]
            im, pts = stretch_part(im, pts, want / cur)
            cfg["parts"][lab] = pts
        # trim fully transparent borders (derived hand/foot images keep the full source canvas)
        a = np.array(im)[..., 3]
        ys, xs = np.nonzero(a > 3)
        if len(xs):
            x0, y0 = max(0, xs.min() - 2), max(0, ys.min() - 2)
            x1, y1 = min(im.width, xs.max() + 3), min(im.height, ys.max() + 3)
            if (x0, y0, x1, y1) != (0, 0, im.width, im.height) and "clip" not in pts:
                im = im.crop((x0, y0, x1, y1))
                pts = {k: ((v[0] - x0, v[1] - y0) if isinstance(v, (tuple, list)) and len(v) == 2 else v) for k, v in pts.items()}
                cfg["parts"][lab] = pts
        im = im.resize((max(1, round(im.width * res * k)), max(1, round(im.height * res * k))), Image.LANCZOS)
        imgs[lab] = im
    # m per source px
    P = cfg["parts"]
    d = lambda a, b: math.dist(a, b)
    hpx = d(P["head"]["pivot"], P["head"]["top"]) + d(P["torso"]["neck"], P["torso"]["hip"]) + \
          d(P["thigh"]["pivot"], P["thigh"]["end"]) + d(P["shin"]["pivot"], P["shin"]["end"]) + abs(P["foot"]["sole"][1] - P["foot"]["pivot"][1])
    mpp = cfg["_mpp"]
    pos, H = pack([(k, v.width, v.height) for k, v in imgs.items()])
    H = int(2 ** math.ceil(math.log2(H + 2)))
    W = 2048
    atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    natlas = Image.new("RGBA", (W, H), (128, 128, 255, 0))
    out = {"name": name, "height": cfg["height"], "atlas": f"assets/chars/{name}.webp", "normal": f"assets/chars/{name}_n.webp",
           "atlasSize": [W, H], "parts": {}}
    for lab, im in imgs.items():
        x, y = pos[lab]
        atlas.paste(im, (x, y))
        natlas.paste(Image.fromarray(normal_map(np.array(im), res)), (x, y))
        pts = P[lab]
        piv = pts["pivot"]
        # size in metres, and points relative to pivot in metres (y up)
        ks = pts.get("scale", 1.0)
        w_src, h_src = im.width / (res * ks), im.height / (res * ks)
        rel = lambda p: [round(float(p[0] - piv[0]) * mpp * ks, 4), round(float(-(p[1] - piv[1])) * mpp * ks, 4)]
        part = {"uv": [x / W, 1 - (y + im.height) / H, im.width / W, im.height / H],
                "size": [round(w_src * mpp * ks, 4), round(h_src * mpp * ks, 4)],
                # offset of the sprite's centre from the pivot
                "center": rel((w_src / 2, h_src / 2))}
        for k, p in pts.items():
            if k in ("pivot", "clip", "src", "scale", "_img", "trim", "noStretch"):
                continue
            part[k] = rel(p)
        out["parts"][lab] = part
    atlas.save(f"public/assets/chars/{name}.webp", quality=92, method=6)
    natlas.save(f"public/assets/chars/{name}_n.webp", lossless=True)
    json.dump(out, open(f"public/assets/chars/{name}.json", "w"), indent=1)
    print(name, "mpp", round(mpp, 5), "atlas", W, H)

if __name__ == "__main__":
    import sys
    for n, c in CHARS.items():
        if len(sys.argv) < 2 or n in sys.argv[1:]:
            build(n, c)
