#!/usr/bin/env python3
"""Generate music with Google Lyria 3 via OpenRouter.

Usage: gen_music.py out.mp3 "prompt" [model] [seed]
  model: google/lyria-3-pro-preview (full songs, up to ~3 min, default)
         google/lyria-3-clip-preview (30 s clips)

API format (found 2026-09-27):
  POST https://openrouter.ai/api/v1/chat/completions
  {"model": ..., "messages": [{"role": "user", "content": prompt}],
   "modalities": ["text", "audio"], "stream": true}
  Streaming is mandatory ("Audio output requires stream: true").
  The SSE stream sends ": OPENROUTER PROCESSING" keep-alive comments, one delta with the
  lyrics/section text in delta.content, then ONE delta with delta.audio.data = base64 MP3
  (44.1 kHz stereo 192 kb/s). Put the duration in the prompt; the pro model follows it.
"""
import base64, json, os, sys, time, urllib.request, urllib.error

URL = "https://openrouter.ai/api/v1/chat/completions"

def generate(out, prompt, model="google/lyria-3-pro-preview", seed=None, retries=3):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "modalities": ["text", "audio"], "stream": True}
    if seed is not None:
        body["seed"] = int(seed)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
                "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
                "Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=900)
            audio, text = [], []
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                chunk = json.loads(payload)
                if "error" in chunk:
                    raise RuntimeError(json.dumps(chunk["error"])[:500])
                for ch in chunk.get("choices", []):
                    d = ch.get("delta", {})
                    if d.get("content"):
                        text.append(d["content"])
                    a = d.get("audio") or {}
                    if a.get("data"):
                        audio.append(a["data"])
            if not audio:
                raise RuntimeError("no audio in response; text=" + "".join(text)[:300])
            data = base64.b64decode("".join(audio))
            os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
            open(out, "wb").write(data)
            print("saved", out, len(data), "bytes; text:", "".join(text)[:200].replace("\n", " "))
            return out
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError, TimeoutError) as e:
            msg = e.read().decode()[:500] if isinstance(e, urllib.error.HTTPError) else str(e)
            print(f"attempt {attempt + 1} failed: {msg}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("failed: " + out)

if __name__ == "__main__":
    a = sys.argv
    if len(a) < 3:
        raise SystemExit(__doc__)
    generate(a[1], a[2], a[3] if len(a) > 3 and a[3] else "google/lyria-3-pro-preview",
             a[4] if len(a) > 4 else None)
