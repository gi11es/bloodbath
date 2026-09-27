#!/usr/bin/env python3
"""Finish short audio (SFX, voice) into game-ready MP3 files.

Usage: finish_audio.py [--voice] [--gasmask] [--peak -1.0] in.wav [in2.wav ...] OUT_DIR
Steps: decode at 44.1 kHz -> trim leading/trailing silence -> (voice: 70 Hz high-pass,
  light compression) -> (gasmask: band-pass + saturation) -> peak normalise -> MP3 128 kb/s.
Prints one JSON line per file with duration, peak and RMS of the encoded MP3.
"""
import argparse, json, os, subprocess, tempfile
import numpy as np
import scipy.io.wavfile as wavfile
from scipy.signal import butter, sosfilt

SR = 44100

def channels(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                          "stream=channels", "-of", "csv=p=0", path], capture_output=True, text=True).stdout
    return int(out.strip() or 1)

def decode(path, extra_af=None):
    # Decode at the native channel count. Do not let ffmpeg upmix mono to stereo:
    # its default upmix lowers each channel by 3 dB, and the peak readings go wrong.
    ch = min(2, channels(path))
    cmd = ["ffmpeg", "-v", "error", "-i", path]
    if extra_af:
        cmd += ["-af", extra_af]
    cmd += ["-ar", str(SR), "-f", "f32le", "-ac", str(ch), "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, ch).astype(np.float64)
    return np.repeat(x, 2, 1) if ch == 1 else x

def trim(x, start_db=-50, end_db=-60):
    a = np.abs(x).max(1)
    pk = a.max()
    if pk <= 1e-6:
        raise SystemExit("silent")
    # Smooth envelope (5 ms) relative to the peak.
    k = int(0.005 * SR)
    envl = np.convolve(a, np.ones(k) / k, "same") / pk
    s_idx = np.where(envl > 10 ** (start_db / 20))[0]
    e_idx = np.where(envl > 10 ** (end_db / 20))[0]
    s = max(0, s_idx[0] - int(0.002 * SR))
    e = min(len(x), e_idx[-1] + int(0.01 * SR))
    y = x[s:e].copy()
    n = min(len(y) // 4, int(0.015 * SR))
    y[-n:] *= np.linspace(1, 0, n)[:, None]
    n0 = min(len(y) // 4, int(0.001 * SR))
    if n0 > 1:
        y[:n0] *= np.linspace(0, 1, n0)[:, None]
    return y

def gasmask(x):
    sos = butter(2, [300 / (SR / 2), 3200 / (SR / 2)], "band", output="sos")
    y = sosfilt(sos, x, axis=0)
    # A small resonant "mask" peak around 1.2 kHz plus soft saturation.
    sos2 = butter(2, [1000 / (SR / 2), 1500 / (SR / 2)], "band", output="sos")
    y = y + 0.6 * sosfilt(sos2, x, axis=0)
    y = y / (np.abs(y).max() + 1e-9)
    return np.tanh(2.2 * y) / np.tanh(2.2)

def encode(x, out, bitrate="128k"):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    wavfile.write(tmp, SR, x.astype(np.float32))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-c:a", "libmp3lame", "-b:a", bitrate, out], check=True)
    os.unlink(tmp)

def stats(path):
    y = decode(path)
    pk = np.abs(y).max()
    rms = np.sqrt((y ** 2).mean())
    return dict(duration=round(len(y) / SR, 3), peakDb=round(20 * np.log10(pk + 1e-12), 2),
                rmsDb=round(20 * np.log10(rms + 1e-12), 2), clipped=int((np.abs(y) >= 0.999).sum()))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", action="store_true")
    ap.add_argument("--gasmask", action="store_true")
    ap.add_argument("--mono", action="store_true")
    ap.add_argument("--peak", type=float, default=-1.0)
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    out_dir = a.files[-1]
    os.makedirs(out_dir, exist_ok=True)
    for f in a.files[:-1]:
        af = None
        if a.voice:
            af = ("highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=4:release=90:makeup=1,"
                  "equalizer=f=160:t=q:w=1:g=2")
        x = decode(f, af)
        x = trim(x, -45 if a.voice else -50, -50 if a.voice else -60)
        if a.gasmask:
            x = gasmask(x)
        if a.mono or a.voice:
            x = np.repeat(x.mean(1, keepdims=True), 2, 1)
        # Encoding can overshoot a little; aim 0.3 dB lower and verify after.
        x = x / (np.abs(x).max() + 1e-12) * 10 ** ((a.peak - 0.3) / 20)
        name = os.path.splitext(os.path.basename(f))[0] + ".mp3"
        out = os.path.join(out_dir, name)
        y = x[:, :1] if (a.mono or a.voice) else x
        encode(y, out)
        # Correction passes: measure the decoded MP3 peak and re-encode toward the target.
        for _ in range(5):
            pk = stats(out)["peakDb"]
            if abs(pk - a.peak) <= 0.3:
                break
            y = np.clip(y * 10 ** ((a.peak - pk) / 20), -1, 1)
            encode(y, out)
        print(json.dumps(dict(file=out, **stats(out))), flush=True)

if __name__ == "__main__":
    main()
