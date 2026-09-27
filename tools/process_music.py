#!/usr/bin/env python3
"""Post-process a generated music track into a game-ready MP3.

Usage:
  process_music.py in.mp3 out.mp3 [--loop] [--cut A B] [--fadein S] [--fadeout S]
                   [--lufs -16] [--xfade 1.5] [--endmin S] [--overlay file.wav@time@gain_db]
Steps: decode (44.1 kHz stereo) -> optional cut -> trim silence -> optional overlay ->
  loop search (--loop) -> fades -> linear gain to the target LUFS (no dynamic
  compression, so loop points stay exact) -> MP3 192 kb/s. Prints a JSON line with
  duration, loopStart, loopEnd and loudness.

Loop search: the script compares 3 s windows of a log band spectrogram before every
candidate start (0.5..25 s) and every candidate end (the last 45 s of the full-energy
region). It picks the most similar pair, refines the end at sample level with waveform
cross-correlation, and then crossfades the audio before loopEnd with the audio before
loopStart. So the jump loopEnd -> loopStart continues the same waveform. The file ends at
loopEnd, so a whole-file loop also works (it restarts at 0 instead of loopStart).
"""
import argparse, json, subprocess, sys, tempfile, os
import numpy as np
from scipy.signal import stft

SR = 44100

def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)

def lufs_of(x):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    write_wav(tmp, x)
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    os.unlink(tmp)
    i = [l for l in out.splitlines() if l.strip().startswith("I:")][-1]
    return float(i.split()[1])

def write_wav(path, x):
    import scipy.io.wavfile as w
    w.write(path, SR, np.clip(x, -1, 1).astype(np.float32))

def trim(x, thr_db=-50):
    a = np.abs(x).max(1)
    idx = np.where(a > 10 ** (thr_db / 20))[0]
    if len(idx) == 0:
        raise SystemExit("silent file")
    s, e = max(0, idx[0] - int(0.005 * SR)), min(len(x), idx[-1] + int(0.05 * SR))
    return x[s:e]

def features(x, hop=2048):
    m = x.mean(1)
    f, t, Z = stft(m, SR, nperseg=4096, noverlap=4096 - hop, boundary=None, padded=False)
    P = np.abs(Z) ** 2
    edges = np.geomspace(40, 16000, 49)
    bands = np.stack([P[(f >= lo) & (f < hi)].sum(0) for lo, hi in zip(edges[:-1], edges[1:])], 1)
    L = np.log(bands + 1e-10)
    # Onset-ish emphasis: add the positive time difference, so rhythm aligns too.
    D = np.maximum(0, np.diff(L, axis=0, prepend=L[:1]))
    return np.concatenate([L - L.mean(0), 2 * D], 1), hop  # frame i covers sample i*hop

def find_loop(x, win_s=3.0, xfade=1.5, endmin=0.0):
    F, hop = features(x)
    fr = SR / hop
    w = int(win_s * fr)
    # Full-energy region: 1 s RMS within 6 dB of the median.
    n1 = SR
    rms = np.array([np.sqrt((x[i:i + n1] ** 2).mean()) for i in range(0, len(x) - n1, hop)])
    db = 20 * np.log10(rms + 1e-9)
    ok = db > np.median(db) - 6
    last_ok = np.where(ok)[0][-1] + int(0.5 * fr)
    last_ok = min(last_ok, len(F) - 1)
    starts = np.arange(max(w, int((xfade + 0.5) * fr)), int(25 * fr))
    lo = max(last_ok - int(45 * fr), starts[-1] + int(40 * fr))
    if endmin:
        lo = min(max(lo, int(endmin * fr)), last_ok - 2)
    ends = np.arange(lo, last_ok)
    def wins(idx):
        M = np.stack([F[i - w:i].ravel() for i in idx])
        M -= M.mean(1, keepdims=True)
        return M / (np.linalg.norm(M, axis=1, keepdims=True) + 1e-9)
    S = wins(starts) @ wins(ends).T
    # Prefer later ends slightly (longer loops).
    S += 0.02 * (np.arange(len(ends)) / len(ends))[None, :]
    i, j = np.unravel_index(np.argmax(S), S.shape)
    s, e = starts[i] * hop, ends[j] * hop
    # Sample refine: align waveform before e to waveform before s (+-30 ms).
    m = x.mean(1)
    seg = int(0.25 * SR); lag = int(0.03 * SR)
    ref = m[s - seg:s]
    best, bl = -1e9, 0
    for L in range(-lag, lag + 1, 4):
        c = np.dot(ref, m[e + L - seg:e + L])
        if c > best:
            best, bl = c, L
    for L in range(bl - 4, bl + 5):
        c = np.dot(ref, m[e + L - seg:e + L])
        if c > best:
            best, bl = c, L
    e += bl
    return s, e, float(S[i, j])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp"); ap.add_argument("out")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--cut", nargs=2, type=float)
    ap.add_argument("--fadein", type=float, default=0.0)
    ap.add_argument("--fadeout", type=float, default=0.0)
    ap.add_argument("--lufs", type=float, default=-16.0)
    ap.add_argument("--xfade", type=float, default=1.5)
    ap.add_argument("--overlay", action="append", default=[])
    ap.add_argument("--endmin", type=float, default=0.0, help="earliest allowed loopEnd (s)")
    a = ap.parse_args()
    x = decode(a.inp)
    if a.cut:
        x = x[int(a.cut[0] * SR):int(a.cut[1] * SR)]
    x = trim(x)
    for ov in a.overlay:
        p, t, g = ov.split("@")
        o = decode(p) * 10 ** (float(g) / 20)
        k = int(float(t) * SR)
        n = min(len(o), len(x) - k)
        x[k:k + n] += o[:n]
    info = {}
    if a.loop:
        s, e, score = find_loop(x, xfade=a.xfade, endmin=a.endmin)
        n = int(a.xfade * SR)
        t = np.linspace(0, np.pi / 2, n)[:, None]
        y = x[:e].copy()
        y[e - n:e] = x[e - n:e] * np.cos(t) + x[s - n:s] * np.sin(t)
        x = y
        info.update(loopStart=round(s / SR, 4), loopEnd=round(e / SR, 4), loopScore=round(score, 3))
    if a.fadein > 0:
        n = int(a.fadein * SR); x[:n] *= np.linspace(0, 1, n)[:, None]
    if a.fadeout > 0:
        n = int(a.fadeout * SR); x[-n:] *= (np.linspace(1, 0, n) ** 2)[:, None]
    L = lufs_of(x)
    g = 10 ** ((a.lufs - L) / 20)
    x = x * g
    pk = np.abs(x).max()
    if pk > 0.97:  # Keep a safety margin under 0 dBFS (sample peak).
        x *= 0.97 / pk
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    write_wav(tmp, x)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-c:a", "libmp3lame", "-b:a", "192k", a.out], check=True)
    os.unlink(tmp)
    info.update(out=a.out, duration=round(len(x) / SR, 3), srcLUFS=L,
                peakDb=round(20 * np.log10(np.abs(x).max()), 2))
    print(json.dumps(info))

if __name__ == "__main__":
    main()
