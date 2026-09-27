#!/usr/bin/env python3
"""Generate an image with an OpenRouter image model. Usage: gen_image.py out.png "prompt" [model] [aspect]

Optional environment variables:
  REFS=a.png,b.png   attach reference images
  IMAGE_SIZE=2K|4K   request a larger output (image_config.image_size, Gemini models)
  RETRIES=3          number of attempts on network or "no image" errors
"""
import base64, json, os, sys, time, urllib.error, urllib.request


def _mime(path):
    ext = os.path.splitext(path)[1].lower()
    return {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext, "image/png")


def generate(out, prompt, model="google/gemini-3-pro-image", aspect=None, ref=None, image_size=None, retries=3):
    content = [{"type": "text", "text": prompt}]
    if ref:
        for r in ref:
            b = base64.b64encode(open(r, "rb").read()).decode()
            content.append({"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (_mime(r), b)}})
    body = {"model": model, "messages": [{"role": "user", "content": content}], "modalities": ["image", "text"]}
    cfg = {}
    if aspect:
        cfg["aspect_ratio"] = aspect
    if image_size:
        cfg["image_size"] = image_size
    if cfg:
        body["image_config"] = cfg
    last = None
    for attempt in range(max(1, retries)):
        try:
            req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=json.dumps(body).encode(),
                headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"], "Content-Type": "application/json"})
            resp = json.load(urllib.request.urlopen(req, timeout=600))
            msg = resp["choices"][0]["message"]
            imgs = msg.get("images") or []
            if not imgs:
                raise RuntimeError("no image: " + json.dumps(resp)[:1500])
            url = imgs[0]["image_url"]["url"]
            open(out, "wb").write(base64.b64decode(url.split(",", 1)[1]))
            print("saved", out, (msg.get("content") or "")[:200])
            return
        except urllib.error.HTTPError as e:
            last = "%s %s" % (e, e.read().decode(errors="replace")[:800])
            print("attempt %d failed: %s" % (attempt + 1, last), file=sys.stderr)
            if 400 <= e.code < 500 and e.code != 429:
                break
            time.sleep(5 * (attempt + 1))
            continue
        except Exception as e:  # network errors, empty responses
            last = e
            print("attempt %d failed: %s" % (attempt + 1, str(e)[:300]), file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("failed: %s" % last)


if __name__ == "__main__":
    a = sys.argv
    refs = [x for x in os.environ.get("REFS", "").split(",") if x]
    generate(a[1], a[2], a[3] if len(a) > 3 and a[3] else "google/gemini-3-pro-image", a[4] if len(a) > 4 else None, refs,
             os.environ.get("IMAGE_SIZE") or None, int(os.environ.get("RETRIES", "3")))
