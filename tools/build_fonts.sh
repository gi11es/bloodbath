#!/usr/bin/env bash
set -euo pipefail

# Keep every glyph and layout feature; WOFF2 changes the transfer encoding,
# not the shapes rendered by the browser. Requires fonttools[woff].
cd "$(dirname "$0")/../public/assets/fonts"
for face in Teko ChakraPetch-Regular ChakraPetch-Bold PressStart2P PirataOne; do
  pyftsubset "${face}.ttf" --glyphs='*' --layout-features='*' --flavor=woff2 \
    --output-file="${face}.woff2"
done
