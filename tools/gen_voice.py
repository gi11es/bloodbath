#!/usr/bin/env python3
"""Generate a voice line with openai/gpt-audio via OpenRouter.

Usage: gen_voice.py out.wav "line to speak" [voice] [style]
  style: announcer (default) | narrator | raw (the line is the full instruction)

API format (found 2026-09-27):
  POST https://openrouter.ai/api/v1/chat/completions
  {"model": "openai/gpt-audio", "messages": [system, user], "modalities": ["text", "audio"],
   "audio": {"voice": "onyx", "format": "pcm16"}, "stream": true}
  Streaming is mandatory, and with stream=true OpenAI only accepts format "pcm16".
  Chunks carry delta.audio.data (base64 PCM16 LE mono 24 kHz) and delta.audio.transcript.
  This script wraps the concatenated PCM in a WAV header.
"""
import base64, json, os, re, sys, time, urllib.request, urllib.error, wave

URL = "https://openrouter.ai/api/v1/chat/completions"

STYLES = {
    "announcer": ("You are a voice actor recording lines for a 1990s arcade run-and-gun game, "
                  "in the style of the Metal Slug announcer. Your voice is extremely deep, booming, "
                  "gravelly and over-the-top dramatic, with huge energy and a cheesy arcade swagger. "
                  "Project like you are shouting to a stadium. Stretch the key vowels. "
                  "Speak ONLY the exact line the user gives, once, in English. No greeting, no "
                  "commentary, no extra words, no laughter."),
    "narrator": ("You are a voice actor narrating the intro cinematic of a dark gothic action game. "
                 "Your voice is very deep, grave, slow and cinematic, like a movie trailer narrator. "
                 "Speak with weight and menace, with dramatic pauses. Speak ONLY the exact line "
                 "the user gives, once, in English. No extra words."),
    "raw": ("You are a voice actor for video game sound effects. Perform exactly what the user "
            "describes as a vocal sound. Do not speak any words unless the user asks for words. "
            "Do not describe the sound. Just perform it."),
}

def norm(s):
    # Collapse stretched vowels ("Shotguuuun" == "Shotgun") before the comparison.
    return re.sub(r"([a-z])\1+", r"\1", re.sub(r"[^a-z ]", "", s.lower())).split()

def generate(out, line, voice="onyx", style="announcer", retries=4, check=True, user_text=None):
    body = {"model": "openai/gpt-audio",
            "messages": [{"role": "system", "content": STYLES[style]},
                         {"role": "user", "content": user_text or ("Line: " + line)}],
            "modalities": ["text", "audio"], "audio": {"voice": voice, "format": "pcm16"},
            "stream": True}
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
                "Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
                "Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=300)
            pcm, tr = [], []
            for raw in resp:
                l = raw.decode("utf-8", "replace").strip()
                if not l.startswith("data: "):
                    continue
                p = l[6:]
                if p == "[DONE]":
                    break
                c = json.loads(p)
                if "error" in c:
                    raise RuntimeError(json.dumps(c["error"])[:500])
                for ch in c.get("choices", []):
                    a = (ch.get("delta") or {}).get("audio") or {}
                    if a.get("data"):
                        pcm.append(a["data"])
                    if a.get("transcript"):
                        tr.append(a["transcript"])
            data = base64.b64decode("".join(pcm))
            transcript = "".join(tr).strip()
            if len(data) < 4800:
                raise RuntimeError("audio too short; transcript=" + transcript)
            import array
            peak = max(abs(v) for v in array.array("h", data[:len(data) // 2 * 2]))
            if peak < 1500:  # About -27 dBFS: the model returned silence.
                raise RuntimeError(f"audio is silent (peak {peak}); transcript={transcript!r}")
            if check and style != "raw" and norm(transcript) != norm(line):
                last = transcript
                raise RuntimeError(f"transcript mismatch: {transcript!r}")
            os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
            with wave.open(out, "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(data)
            print(f"saved {out} {len(data) / 48000:.2f}s transcript={transcript!r}")
            return transcript
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError, TimeoutError) as e:
            msg = e.read().decode()[:500] if isinstance(e, urllib.error.HTTPError) else str(e)
            print(f"{out}: attempt {attempt + 1} failed: {msg}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise SystemExit(f"failed: {out} last={last!r}")

if __name__ == "__main__":
    a = sys.argv
    if len(a) < 3:
        raise SystemExit(__doc__)
    generate(a[1], a[2], a[3] if len(a) > 3 else "onyx", a[4] if len(a) > 4 else "announcer")
