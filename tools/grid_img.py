import sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
bg = Image.new("RGBA", (im.width + 30, im.height + 30), (35, 35, 50, 255)); bg.alpha_composite(im, (30, 30))
d = ImageDraw.Draw(bg)
for x in range(0, im.width, 25):
    d.line([(30 + x, 30), (30 + x, bg.height)], fill=(255, 255, 0, 120) if x % 50 == 0 else (255, 255, 255, 40))
    if x % 100 == 0: d.text((26 + x, 4), str(x), fill=(255, 255, 0))
for y in range(0, im.height, 25):
    d.line([(30, 30 + y), (bg.width, 30 + y)], fill=(255, 255, 0, 120) if y % 50 == 0 else (255, 255, 255, 40))
    if y % 50 == 0: d.text((2, 26 + y), str(y), fill=(255, 255, 0))
bg.save(out)
