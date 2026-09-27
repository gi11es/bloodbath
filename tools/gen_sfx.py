#!/usr/bin/env python3
"""Offline procedural SFX synthesis for Bloodbath (numpy/scipy).

Usage: gen_sfx.py OUT_DIR [name ...]
Writes OUT_DIR/<name>.wav (44.1 kHz, float). Without names, it renders every sound.
Each variation uses its own random seed and small pitch/timing changes.
The encode step (mp3, peak normalise) happens in tools/finish_audio.py.
"""
import os, sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import scipy.io.wavfile as wavfile

SR = 44100
rng = np.random.default_rng(0)


# ---------------------------------------------------------------- primitives
def T(d):
    return np.arange(int(d * SR)) / SR

def noise(d):
    return rng.standard_normal(int(d * SR))

def pink(d):
    n = int(d * SR)
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR); f[0] = 1
    return norm(np.fft.irfft(X / np.sqrt(f), n))

def brown(d):
    x = np.cumsum(rng.standard_normal(int(d * SR)))
    return norm(hp(x, 20))

def norm(x):
    return x / (np.abs(x).max() + 1e-12)

def env_exp(d, tau, attack=0.001):
    t = T(d)
    e = np.exp(-t / tau)
    a = int(attack * SR)
    if a > 1:
        e[:a] *= np.linspace(0, 1, a)
    return e

def env_ad(d, a, dcy, curve=3.0):
    """Attack then a power-law decay to 0 at the end."""
    n = int(d * SR); na = max(1, int(a * SR))
    e = np.ones(n)
    e[:na] = np.linspace(0, 1, na)
    rest = n - na
    e[na:] = (1 - np.linspace(0, 1, rest)) ** curve
    return e

def sweep(d, f0, f1, curve="exp", shape="sine"):
    t = T(d)
    if curve == "exp":
        f = f0 * (f1 / f0) ** (t / d)
    else:
        f = f0 + (f1 - f0) * (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if shape == "sine":
        return np.sin(ph)
    if shape == "saw":
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if shape == "square":
        return np.sign(np.sin(ph))
    if shape == "tri":
        return 2 * np.abs(2 * ((ph / (2 * np.pi)) % 1) - 1) - 1

def freq_sig(f):
    """Sine with an arbitrary per-sample frequency array."""
    return np.sin(2 * np.pi * np.cumsum(f) / SR)

def _sos(kind, f, order=2):
    ny = SR / 2
    if kind == "bp":
        lo, hi = f
        return butter(order, [max(10, lo) / ny, min(hi, ny * 0.95) / ny], "band", output="sos")
    return butter(order, min(f, ny * 0.95) / ny, "low" if kind == "lp" else "high", output="sos")

def lp(x, f, order=2): return sosfilt(_sos("lp", f, order), x)
def hp(x, f, order=2): return sosfilt(_sos("hp", f, order), x)
def bp(x, lo, hi, order=2): return sosfilt(_sos("bp", (lo, hi), order), x)

def svf(x, fc, q=0.7, mode="bp"):
    """Time-varying state-variable filter (TPT). fc may be an array."""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    g = np.tan(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    k = 1.0 / q
    a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2
    ic1 = ic2 = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        v3 = x[i] - ic2
        v1 = a1[i] * ic1 + a2[i] * v3
        v2 = ic2 + a2[i] * ic1 + a3[i] * v3
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2
        out[i] = v1 if mode == "bp" else (v2 if mode == "lp" else x[i] - k * v1 - v2)
    return out

def dist(x, drive=3.0):
    return np.tanh(drive * x) / np.tanh(drive)

def pad(x, d):
    n = int(d * SR)
    return np.concatenate([x, np.zeros(max(0, n - len(x)))]) if len(x) < n else x[:n]

def mix(*parts, d=None):
    """parts: (signal, start_s, gain)."""
    n = max(int(s * SR) + len(x) for x, s, g in parts)
    if d: n = max(n, int(d * SR))
    out = np.zeros(n)
    for x, s, g in parts:
        k = int(s * SR); out[k:k + len(x)] += g * x
    return out

def ir(d, tau, lp_f=6000, pre=0.0, density_seed=None):
    """Synthetic reverb impulse response (stereo, decorrelated)."""
    chans = []
    for c in range(2):
        n = noise(d) * env_exp(d, tau)
        n = lp(n, lp_f)
        if pre: n = np.concatenate([np.zeros(int(pre * SR)), n])
        chans.append(n / np.sqrt((n ** 2).sum()))
    return chans

def reverb(x, d=1.2, tau=0.25, wet=0.25, lp_f=6000, pre=0.01, stereo=True):
    L, R = ir(d, tau, lp_f, pre)
    wl = fftconvolve(x, L); wr = fftconvolve(x, R)
    dry = np.concatenate([x, np.zeros(len(wl) - len(x))])
    if not stereo:
        return dry + wet * (wl + wr) / 2
    return np.stack([dry + wet * wl, dry + wet * wr], 1)

def fade_out(x, d=0.01):
    n = min(len(x), int(d * SR))
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n)[:, None] if x.ndim == 2 else np.linspace(1, 0, n)
    return x

def click(d=0.004, f=4000):
    return hp(noise(d), f) * env_exp(d, d / 4)

def thump(f0, f1, d, tau):
    return sweep(d, f0, f1) * env_exp(d, tau, 0.0005)

def droplets(n, d, fmin=500, fmax=2000, gmin=0.2, gmax=1.0):
    """Short upward-gliding sine blips: liquid bubbles and droplets."""
    out = np.zeros(int(d * SR) + SR // 5)
    for _ in range(n):
        dd = rng.uniform(0.008, 0.04)
        f0 = rng.uniform(fmin, fmax)
        s = sweep(dd, f0, f0 * rng.uniform(1.5, 3.0)) * env_exp(dd, dd / 3, 0.001)
        k = int(rng.uniform(0, d) * SR)
        out[k:k + len(s)] += rng.uniform(gmin, gmax) * s
    return out

def crackle(d, rate, lo=1500, hi=7000, decay=None):
    """Sparse random impulses (bone crunch, debris, fire crackle)."""
    n = int(d * SR)
    x = np.zeros(n)
    dens = rate / SR
    if decay is not None:
        prob = dens * np.exp(-np.arange(n) / SR / decay)
    else:
        prob = np.full(n, dens)
    idx = np.where(rng.random(n) < prob)[0]
    x[idx] = rng.uniform(-1, 1, len(idx))
    return bp(x, lo, hi)

def add(*xs):
    """Sum signals of different lengths (zero-pad the shorter ones)."""
    n = max(len(x) for x in xs)
    out = np.zeros(n)
    for x in xs:
        out[:len(x)] += x
    return out

def pitch(x, factor):
    """Resample to change the pitch and length together."""
    n = int(len(x) / factor)
    return np.interp(np.arange(n) * factor, np.arange(len(x)), x)


# ---------------------------------------------------------------- sounds
def gunshot(v, heavy=False):
    p = 1 + 0.06 * (v - 1)
    d = 0.9 if heavy else 0.6
    crack = hp(noise(0.012), 2500) * env_exp(0.012, 0.003)
    body = lp(noise(0.25), 3500 if not heavy else 2600) * env_exp(0.25, 0.028 if not heavy else 0.04)
    boom = thump(180 * p, 45, 0.25, 0.05 if not heavy else 0.08)
    mid = bp(noise(0.12), 500, 1600) * env_exp(0.12, 0.02)
    mech = bp(crackle(0.05, 900), 2000, 6000) * env_exp(0.05, 0.012)
    tail = bp(noise(d), 200, 1800) * env_exp(d, 0.12 if not heavy else 0.18, 0.01)
    x = mix((crack, 0, 1.0), (dist(body, 3), 0.0005, 0.9), (boom, 0, 1.3 if heavy else 1.0),
            (mid, 0.001, 0.6), (mech, 0.002, 0.3), (tail, 0.004, 0.18))
    x = dist(x * 1.4, 2.0)
    x = pitch(x, p * (0.85 if heavy else 1.0))
    return reverb(x, 1.0, 0.18, 0.18, 5000, 0.02)

def rifle(v): return gunshot(v)
def hmg(v): return gunshot(v, heavy=True)

def shotgun(v):
    p = 1 + 0.05 * (v - 1)
    blast = dist(lp(noise(0.5), 2200) * env_exp(0.5, 0.06), 4)
    crack = hp(noise(0.02), 1800) * env_exp(0.02, 0.006)
    sub = thump(110 * p, 32, 0.5, 0.12)
    tail = bp(pink(1.0), 120, 1200) * env_exp(1.0, 0.25, 0.02)
    # Pump action: "chk ... chk".
    def pump(g=1.0):
        return mix((bp(crackle(0.04, 3000), 1500, 5000) * env_exp(0.04, 0.01), 0, g),
                   (bp(noise(0.03), 600, 1500) * env_exp(0.03, 0.008), 0, 0.6 * g))
    x = mix((crack, 0, 1.0), (blast, 0, 1.0), (sub, 0, 1.6), (tail, 0.01, 0.25),
            (pump(), 0.42, 0.35), (pump(0.8), 0.56, 0.4))
    x = dist(x * 1.2, 1.5)
    return reverb(pitch(x, p), 1.4, 0.25, 0.2, 4500, 0.025)

def ripper_fire(v):
    d = 0.7
    t = T(d)
    f = 900 * np.exp(-t * 1.2) + 500
    whirr = freq_sig(f) * (0.5 + 0.5 * np.sin(2 * np.pi * 55 * t)) + 0.5 * freq_sig(f * 2.03)
    whirr = dist(whirr, 2) * env_ad(d, 0.01, d, 1.6)
    whoosh = svf(noise(d), 800 + 2500 * np.exp(-t * 4), 1.2) * env_ad(d, 0.02, d, 2)
    launch = add(thump(220, 70, 0.15, 0.04), 0.5 * click(0.006, 3000))
    x = mix((launch, 0, 1.0), (whirr, 0.0, 0.45), (whoosh, 0.0, 0.8))
    return reverb(x, 0.8, 0.15, 0.15)

def ripper_hit(v):
    d = 0.45
    t = T(d)
    f0 = 170 if v == 1 else 210
    buzz = sweep(d, f0, f0 * 0.8, shape="saw") * (0.6 + 0.4 * np.sin(2 * np.pi * 38 * t))
    buzz = bp(dist(buzz, 4), 400, 4000) * env_ad(d, 0.005, d, 1.5)
    grind = bp(noise(d), 2000, 7000) * env_ad(d, 0.003, d, 2) * (0.5 + 0.5 * np.sin(2 * np.pi * 60 * t))
    x = mix((buzz, 0, 0.7), (grind, 0, 0.4), (splat_core(0.5), 0.0, 0.8), (crunch(0.15), 0.01, 0.4))
    return reverb(x, 0.6, 0.1, 0.12)

def grenade_throw(v):
    pin = 0
    for fr, g in [(3100, 1), (4800, 0.6), (7300, 0.3)]:
        pin = pin + g * np.sin(2 * np.pi * fr * T(0.25)) * env_exp(0.25, 0.05)
    pin = add(pin, click(0.003, 5000))
    d = 0.45; t = T(d)
    whoosh = svf(noise(d), 500 + 1800 * np.sin(np.pi * t / d), 1.5) * np.sin(np.pi * t / d) ** 2
    x = mix((pin, 0, 0.35), (whoosh, 0.18, 0.9))
    return reverb(x, 0.6, 0.12, 0.12)

def explosion(v):
    p = 1 + 0.07 * (v - 2)
    d = 3.0; t = T(d)
    sub = sweep(d, 70 * p, 22, "exp") * env_exp(d, 0.45, 0.002)
    crack = dist(hp(noise(0.05), 1000) * env_exp(0.05, 0.012), 3)
    roar = svf(brown(d) * 0.7 + 0.3 * noise(d), 6000 * np.exp(-t * 3.5) + 180, 0.8, "lp")
    roar = dist(roar * env_exp(d, 0.5, 0.005) * 2.5, 2.5)
    debris = crackle(2.2, 180, 1200, 6000, decay=0.7) * env_ad(2.2, 0.05, 2.2, 1.5)
    rumble = lp(brown(d), 120) * env_ad(d, 0.08, d, 1.3)
    x = mix((crack, 0, 1.0), (sub, 0, 1.4), (roar, 0, 1.0), (debris, 0.05, 0.35), (rumble, 0, 0.8))
    x = dist(x, 1.3)
    return reverb(x, 2.5, 0.6, 0.35, 3500, 0.03)

def splat_core(d=0.4, bright=1.0):
    t = T(d)
    thwap = thump(230, 70, 0.08, 0.02)
    wet = svf(noise(d), 2200 * bright * np.exp(-t * 9) + 350, 1.6) * env_exp(d, 0.06, 0.001)
    squish = lp(noise(d), 1100) * env_exp(d, 0.09, 0.002) * (0.6 + 0.4 * np.sin(2 * np.pi * 30 * t))
    return mix((thwap, 0, 0.9), (wet, 0, 1.0), (squish, 0, 0.6),
               (droplets(rng.integers(6, 12), d * 0.8, 350, 1600), 0.01, 0.35))

def splat(v):
    x = splat_core(0.45 + 0.05 * v, 0.8 + 0.15 * v)
    x = mix((x, 0, 1.0), (droplets(rng.integers(4, 9), 0.4, 600, 2400, 0.1, 0.4), 0.12, 0.35))
    return reverb(dist(x, 1.5), 0.5, 0.08, 0.1)

def squelch(v):
    d = 0.35; t = T(d)
    thud = thump(140 - 10 * v, 55, 0.12, 0.035)
    goo = svf(noise(d), 1000 * np.exp(-t * 7) + 250, 3.0) * env_exp(d, 0.07, 0.003)
    x = mix((thud, 0, 1.0), (goo, 0, 0.9), (click(0.003, 3000), 0, 0.3),
            (droplets(5, 0.2, 300, 1000), 0.01, 0.25))
    return reverb(dist(x, 2), 0.4, 0.06, 0.08)

def crunch(d):
    return dist(crackle(d, 1800, 1500, 6500) * env_exp(d, d / 3), 2) + \
        0.5 * bp(noise(d), 300, 1200) * env_exp(d, d / 4)

def gore(v):
    d = 0.7; t = T(d)
    tear = svf(noise(0.45), np.linspace(700, 2600, int(0.45 * SR)), 2.0)
    tear = tear * (0.55 + 0.45 * np.sign(np.sin(2 * np.pi * rng.uniform(35, 55) * T(0.45)))) * env_ad(0.45, 0.03, 0.45, 1.3)
    x = mix((thump(120, 45, 0.15, 0.05), 0, 1.0), (crunch(0.18), 0, 0.9),
            (splat_core(0.5), 0.02, 0.9), (tear, 0.08, 0.6),
            (droplets(10, 0.5, 300, 1400), 0.15, 0.3))
    return reverb(dist(x, 1.8), 0.6, 0.1, 0.1)

def spurt(v):
    d = 0.55; t = T(d)
    pulse = np.clip(np.sin(np.pi * t / 0.18), 0, None) ** 0.5 * (t < 0.18) + \
        0.8 * np.clip(np.sin(np.pi * (t - 0.22) / 0.2), 0, None) ** 0.5 * (t > 0.22) * (t < 0.42)
    hiss = svf(noise(d), 3200 - 1500 * t / d, 1.2) * pulse * (0.7 + 0.3 * np.sin(2 * np.pi * 24 * t))
    x = mix((hiss, 0, 0.9), (droplets(18, 0.5, 500, 2200, 0.1, 0.5), 0.02, 0.4),
            (lp(noise(d), 700) * pulse, 0, 0.4))
    return reverb(x, 0.4, 0.06, 0.1)

def drip(v):
    f0 = [700, 900, 1150][v - 1]
    s = sweep(0.05, f0, f0 * 2.8) * env_exp(0.05, 0.012, 0.0005)
    s2 = sweep(0.03, f0 * 1.4, f0 * 3) * env_exp(0.03, 0.006)
    x = mix((s, 0, 1), (s2, 0.012, 0.3), (click(0.002, 2000), 0, 0.15), d=0.1)
    return reverb(x, 0.8, 0.2, 0.25, 5000, 0.02)

def armor_hit(v):
    d = 0.9; t = T(d)
    ping = 0
    base = rng.uniform(2200, 3000)
    for r, g, tau in [(1, 1, 0.09), (1.73, 0.7, 0.07), (2.61, 0.5, 0.05), (3.9, 0.3, 0.03)]:
        ping = ping + g * np.sin(2 * np.pi * base * r * t) * env_exp(d, tau)
    impact = dist(hp(noise(0.02), 1500) * env_exp(0.02, 0.004), 3)
    wf0 = rng.uniform(2600, 3800)
    wd = 0.45 + 0.1 * v
    whine = sweep(wd, wf0, wf0 * 0.55) * (1 + 0.02 * np.sin(2 * np.pi * 18 * T(wd)))
    whine = whine * env_ad(wd, 0.01, wd, 1.4)
    chips = crackle(0.2, 400, 3000, 9000, decay=0.06)
    x = mix((impact, 0, 1.0), (ping, 0, 0.45), (whine, 0.03, 0.3 if v != 2 else 0.12), (chips, 0, 0.5),
            (thump(400, 150, 0.04, 0.01), 0, 0.3), d=d)
    return reverb(x, 0.9, 0.18, 0.18, 7000, 0.02)

def enemy_shot(v):
    d = 0.5; t = T(d)
    zap = sweep(0.12, 1800, 160) * env_exp(0.12, 0.04)
    zap2 = sweep(0.12, 2700, 240, shape="square") * env_exp(0.12, 0.02)
    body = lp(noise(0.2), 2500) * env_exp(0.2, 0.025)
    x = mix((zap, 0, 0.7), (lp(zap2, 3000), 0, 0.15), (dist(body, 3), 0, 0.7), (thump(160, 60, 0.15, 0.03), 0, 0.6),
            (bp(noise(d), 300, 2000) * env_exp(d, 0.1, 0.005), 0.005, 0.12))
    return reverb(dist(x, 1.5), 0.8, 0.15, 0.15)

def enemy_laser_charge(v):
    d = 1.3; t = T(d)
    f = 180 * (12 ** (t / d) )
    trem = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(4 + 40 * (t / d) ** 2) / SR)
    tone = (freq_sig(f) + 0.4 * freq_sig(f * 1.5) + 0.25 * sweep(d, 90, 400, shape="saw")) * trem
    build = svf(noise(d), 300 + 5000 * (t / d) ** 2, 2.0) * (t / d) ** 2
    x = (0.6 * tone + 0.5 * build) * (t / d) ** 1.2
    x = mix((x, 0, 1.0), (sweep(0.15, 2500, 3500) * env_exp(0.15, 0.05), d - 0.02, 0.4))
    return reverb(dist(x, 1.5), 0.8, 0.15, 0.15)

def footstep(v):
    d = 0.2
    x = mix((thump(110 + 15 * v, 50, 0.08, 0.018), 0, 1.0),
            (bp(noise(0.06), 900, 3500) * env_exp(0.06, 0.012, 0.002), 0.002, 0.5),
            (crackle(0.08, 800, 2000, 6000, decay=0.03), 0.005, 0.3), d=d)
    return reverb(x, 0.3, 0.05, 0.08)

def jump(v):
    d = 0.3; t = T(d)
    whoosh = svf(noise(d), 500 + 1500 * t / d, 1.2) * np.sin(np.pi * t / d) ** 2
    x = mix((thump(90, 60, 0.07, 0.02), 0, 0.6), (bp(noise(0.05), 800, 3000) * env_exp(0.05, 0.01), 0, 0.35),
            (whoosh, 0.01, 0.6))
    return reverb(x, 0.3, 0.05, 0.06)

def double_jump(v):
    d = 0.45; t = T(d)
    whoosh = svf(noise(d), 700 + 2800 * np.sin(np.pi * t / d), 2.0) * np.sin(np.pi * t / d) ** 1.5
    fw = sweep(0.25, 180, 420) * env_ad(0.25, 0.02, 0.25, 2)
    x = mix((whoosh, 0, 0.8), (fw, 0, 0.35), (thump(140, 80, 0.06, 0.015), 0, 0.4))
    return reverb(x, 0.6, 0.12, 0.15)

def land(v):
    d = 0.35
    x = mix((thump(95, 38, 0.2, 0.05), 0, 1.3), (bp(noise(0.12), 600, 3000) * env_exp(0.12, 0.025, 0.002), 0, 0.6),
            (crackle(0.15, 600, 1500, 5000, decay=0.05), 0.005, 0.4), d=d)
    return reverb(dist(x, 1.5), 0.4, 0.07, 0.1)

def dash(v):
    d = 0.35; t = T(d)
    whoosh = svf(noise(d), 400 + 3000 * np.sin(np.pi * t / d) ** 2, 1.0) * np.sin(np.pi * t / d) ** 1.2
    x = mix((whoosh, 0, 1.0), (thump(120, 50, 0.2, 0.06), 0, 0.5), (lp(brown(d), 200) * np.sin(np.pi * t / d), 0, 0.4))
    return reverb(x, 0.5, 0.1, 0.12)

def slide(v):
    d = 0.55; t = T(d)
    scrape = bp(noise(d), 700, 3500) * (0.6 + 0.4 * np.abs(np.sin(2 * np.pi * 17 * t + rng.random(len(t)) * 0.8)))
    scrape = scrape * env_ad(d, 0.02, d, 1.2)
    x = mix((scrape, 0, 0.8), (crackle(d, 500, 1500, 6000) * env_ad(d, 0.02, d, 1.2), 0, 0.4),
            (lp(brown(d), 250) * env_ad(d, 0.02, d, 1.5), 0, 0.5))
    return reverb(x, 0.4, 0.07, 0.08)

def swoosh(d, fpk):
    t = T(d)
    c = 500 + fpk * np.exp(-((t - d * 0.45) / (d * 0.22)) ** 2)
    return svf(noise(d), c, 2.2) * np.exp(-((t - d * 0.45) / (d * 0.25)) ** 2)

def slash(v):
    d = 0.28 + 0.03 * v
    x = mix((swoosh(d, 2600 + 400 * v), 0, 1.0),
            (np.sin(2 * np.pi * (3400 + 200 * v) * T(0.3)) * env_exp(0.3, 0.06), 0.1, 0.05))
    return reverb(x, 0.4, 0.08, 0.1)

def slash_hit(v):
    x = mix((swoosh(0.22, 3000), 0, 0.7), (thump(150, 50, 0.15, 0.04), 0.12, 1.0),
            (crunch(0.12), 0.12, 0.7 if v == 1 else 1.0), (splat_core(0.4), 0.125, 0.9))
    return reverb(dist(x, 1.6), 0.5, 0.08, 0.1)

def execution(v):
    x = mix((thump(90, 28, 0.8, 0.2), 0, 1.6), (crunch(0.25), 0, 1.0), (splat_core(0.6, 0.8), 0, 1.0),
            (dist(lp(noise(0.3), 1500) * env_exp(0.3, 0.05), 4), 0, 0.7),
            (splat_core(0.5, 1.2), 0.09, 0.6), (droplets(25, 0.8, 300, 1800), 0.1, 0.35))
    return reverb(dist(x, 2.0), 1.6, 0.35, 0.25, 4000, 0.03)

def tone(f, d, shape="square", tau=None, lpf=5000):
    s = sweep(d, f, f, "lin", shape)
    s = lp(s, lpf) if shape != "sine" else s
    return s * (env_exp(d, tau, 0.002) if tau else env_ad(d, 0.003, d, 1.5))

def pickup(v):
    notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    parts = [(tone(f, 0.12, "square", 0.05, 4000) + 0.5 * tone(f * 2, 0.12, "sine", 0.04), i * 0.045, 0.5)
             for i, f in enumerate(notes)]
    shimmer = hp(noise(0.5), 6000) * env_exp(0.5, 0.12, 0.05)
    x = mix(*parts, (shimmer, 0.05, 0.1), (tone(2093, 0.4, "sine", 0.12), 0.22, 0.25))
    return reverb(x, 0.8, 0.2, 0.2)

def health(v):
    notes = [261.63, 329.63, 392.0, 523.25]
    parts = [(tone(f, 0.5, "tri", 0.2, 3000), i * 0.07, 0.5) for i, f in enumerate(notes)]
    gulp = sweep(0.09, 180, 520) * env_exp(0.09, 0.03)
    x = mix(*parts, (gulp, 0, 0.5), (gulp, 0.16, 0.4), (thump(60, 45, 0.2, 0.06), 0, 0.6))
    return reverb(x, 1.0, 0.25, 0.25)

def heartbeat_core(g=1.0):
    lub = add(thump(62, 42, 0.18, 0.05), 0.3 * lp(noise(0.05), 200) * env_exp(0.05, 0.015))
    dub = thump(75, 50, 0.15, 0.04)
    return mix((dist(lub, 2), 0, g), (dist(dub, 2), 0.28, 0.7 * g))

def heartbeat(v):
    return reverb(pad(heartbeat_core(), 0.85), 0.5, 0.1, 0.1)

def frenzy_start(v):
    d = 1.4; t = T(d)
    swell = svf(noise(d), 150 + 2500 * (t / d) ** 3, 0.9, "lp") * (t / d) ** 2.5
    sub = sweep(d, 30, 60) * (t / d) ** 2
    boom = thump(90, 25, 1.2, 0.3)
    x = mix((swell, 0, 0.8), (sub, 0, 0.6), (dist(boom, 2), d, 1.4),
            (lp(noise(0.6), 800) * env_exp(0.6, 0.12), d, 0.5),
            (heartbeat_core(1.0), d + 0.5, 1.0), (heartbeat_core(0.9), d + 1.2, 1.0))
    return reverb(x, 1.8, 0.4, 0.25, 3000, 0.03)

def shell(v):
    d = 0.7
    out = np.zeros(int(d * SR))
    base = rng.uniform(2800, 3600)
    times = [0, 0.13 + 0.02 * v, 0.23 + 0.03 * v, 0.3 + 0.03 * v, 0.35 + 0.03 * v]
    for i, tt in enumerate(times):
        g = 0.75 ** i
        b = base * rng.uniform(0.97, 1.03)
        s = 0
        for r, a, tau in [(1, 1, 0.05), (2.76, 0.6, 0.03), (5.4, 0.35, 0.02), (8.93, 0.2, 0.012)]:
            s = s + a * np.sin(2 * np.pi * b * r * T(0.2) + rng.random() * 6) * env_exp(0.2, tau * (1 - 0.1 * i))
        s = add(s, 0.4 * click(0.002, 4000))
        k = int(tt * SR); out[k:k + len(s)] += g * s[:len(out) - k]
    return reverb(out, 0.5, 0.1, 0.12, 8000)

def ui_move(v):
    x = mix((tone(1400, 0.04, "sine", 0.012), 0, 0.8), (click(0.003, 3000), 0, 0.3), (tone(2800, 0.03, "sine", 0.008), 0, 0.2))
    return reverb(x, 0.3, 0.05, 0.08)

def ui_select(v):
    x = mix((tone(880, 0.07, "square", 0.04, 4000), 0, 0.5), (tone(1320, 0.18, "square", 0.07, 5000), 0.06, 0.5),
            (thump(200, 90, 0.08, 0.02), 0, 0.4), (click(0.003, 3000), 0, 0.3))
    return reverb(x, 0.5, 0.1, 0.12)

def ui_back(v):
    x = mix((tone(990, 0.07, "square", 0.04, 3500), 0, 0.5), (tone(660, 0.15, "square", 0.06, 3000), 0.06, 0.5),
            (click(0.003, 3000), 0, 0.2))
    return reverb(x, 0.5, 0.1, 0.12)

def metal_ring(d, base, tau):
    s = 0
    for r, a in [(1, 1), (1.41, 0.8), (2.23, 0.6), (2.97, 0.4), (4.1, 0.25), (5.33, 0.15)]:
        s = s + a * np.sin(2 * np.pi * base * r * T(d) + rng.random() * 6) * env_exp(d, tau / r ** 0.5)
    return s

def ui_start(v):
    d = 2.5; t = T(d)
    x = mix((thump(100, 28, d, 0.45), 0, 1.4), (dist(lp(noise(0.4), 3000) * env_exp(0.4, 0.07), 3), 0, 0.8),
            (metal_ring(d, 110, 0.6), 0, 0.35), (hp(noise(d), 3000) * env_exp(d, 0.3, 0.002), 0, 0.2),
            (sweep(0.6, 400, 1600) * env_exp(0.6, 0.2), 0, 0.12))
    return reverb(dist(x, 1.4), 2.8, 0.7, 0.35, 5000, 0.03)

def whoosh(v):
    d = 1.6; t = T(d)
    shape = np.sin(np.pi * t / d) ** 2
    c = 300 + 3500 * np.sin(np.pi * t / d) ** 3
    L = svf(noise(d), c, 1.5) * shape
    R = svf(noise(d), c * 1.05, 1.5) * shape
    pan = t / d
    sub = sweep(d, 50, 80) * shape * 0.5
    st = np.stack([L * (1 - 0.6 * pan) + sub, R * (0.4 + 0.6 * pan) + sub], 1)
    wl = reverb(st[:, 0], 1.5, 0.35, 0.3, 6000, 0.02, stereo=False)
    wr = reverb(st[:, 1], 1.5, 0.35, 0.3, 6000, 0.03, stereo=False)
    n = min(len(wl), len(wr))
    return np.stack([wl[:n], wr[:n]], 1)

def boom_hit(v):
    d = 3.5
    x = mix((sweep(d, 85, 26) * env_exp(d, 0.7, 0.002), 0, 1.5),
            (dist(lp(noise(0.5), 2500) * env_exp(0.5, 0.08), 4), 0, 0.9),
            (hp(noise(0.03), 1500) * env_exp(0.03, 0.008), 0, 0.6),
            (lp(brown(d), 150) * env_exp(d, 0.8, 0.01), 0, 0.8),
            (metal_ring(d, 65, 0.9), 0, 0.2))
    return reverb(dist(x, 1.5), 3.5, 0.9, 0.4, 3500, 0.03)

def glass_break(v):
    d = 1.6
    out = np.zeros(int(d * SR))
    for _ in range(260):
        tt = rng.exponential(0.18)
        if tt > d - 0.2: continue
        f = rng.uniform(2200, 11000)
        dd = rng.uniform(0.02, 0.12)
        g = rng.uniform(0.1, 1.0) * np.exp(-tt / 0.5)
        s = np.sin(2 * np.pi * f * T(dd) + rng.random() * 6) * env_exp(dd, dd / 4, 0.0005)
        k = int(tt * SR); out[k:k + len(s)] += g * s
    crack = dist(hp(noise(0.05), 1200) * env_exp(0.05, 0.012), 3)
    gush = lp(noise(d), 900) * env_ad(d, 0.1, d, 1.5)
    x = mix((crack, 0, 1.0), (thump(160, 60, 0.2, 0.05), 0, 0.9), (out, 0, 0.35), (gush, 0.05, 0.4),
            (droplets(30, 1.0, 400, 1500), 0.2, 0.3))
    return reverb(x, 1.5, 0.3, 0.25, 8000, 0.02)

def low_health_alarm(v):
    def beep():
        return tone(880, 0.16, "square", None, 3000) * 0.6 + tone(1760, 0.16, "sine", None) * 0.2
    x = mix((beep(), 0, 1.0), (beep(), 0.22, 1.0), d=1.0)
    return reverb(x, 0.4, 0.06, 0.08)


# name -> (function, number of variations)
SOUNDS = {
    "rifle": (rifle, 3), "hmg": (hmg, 3), "shotgun": (shotgun, 2), "ripper_fire": (ripper_fire, 1),
    "ripper_hit": (ripper_hit, 2), "grenade_throw": (grenade_throw, 1), "explosion": (explosion, 3),
    "splat": (splat, 4), "squelch": (squelch, 3), "gore": (gore, 3), "spurt": (spurt, 1), "drip": (drip, 3),
    "armor_hit": (armor_hit, 3), "enemy_shot": (enemy_shot, 1), "enemy_laser_charge": (enemy_laser_charge, 1),
    "footstep": (footstep, 3), "jump": (jump, 1), "double_jump": (double_jump, 1), "land": (land, 1),
    "dash": (dash, 1), "slide": (slide, 1), "slash": (slash, 3), "slash_hit": (slash_hit, 2),
    "execution": (execution, 1), "pickup": (pickup, 1), "health": (health, 1), "frenzy_start": (frenzy_start, 1),
    "heartbeat": (heartbeat, 1), "shell": (shell, 2), "ui_move": (ui_move, 1), "ui_select": (ui_select, 1),
    "ui_back": (ui_back, 1), "ui_start": (ui_start, 1), "whoosh": (whoosh, 1), "boom_hit": (boom_hit, 1),
    "glass_break": (glass_break, 1), "low_health_alarm": (low_health_alarm, 1),
}

def render(out_dir, names=None):
    global rng
    os.makedirs(out_dir, exist_ok=True)
    for i, (name, (fn, n)) in enumerate(SOUNDS.items()):
        if names and name not in names: continue
        for v in range(1, n + 1):
            rng = np.random.default_rng(1000 * i + v)
            x = np.asarray(fn(v), float)
            x = fade_out(x, 0.02)
            x = x / (np.abs(x).max() + 1e-12) * 0.9
            fname = f"{name}_{v}.wav" if n > 1 else f"{name}.wav"
            wavfile.write(os.path.join(out_dir, fname), SR, x.astype(np.float32))
            print("wrote", fname, f"{len(x) / SR:.2f}s", flush=True)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    render(sys.argv[1], sys.argv[2:] or None)
