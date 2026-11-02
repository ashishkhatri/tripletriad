#!/usr/bin/env bash
# Rasterizes each pack's outline into a small white alpha mask (public/packs/<set>-mask.png and -back-mask.png).
# The pack's lighting layers are cut to these masks; a bitmap mask is far cheaper for browsers to apply every
# frame than the full SVG artwork. Needs rsvg-convert and ImageMagick. Run after tools/genpacks.js.
set -euo pipefail
cd "$(dirname "$0")/../public/packs"
for svg in *.svg; do
  name="${svg%.svg}"
  [[ "$name" == *-mask ]] && continue
  rsvg-convert -w 450 -h 690 "$svg" -o "/tmp/$name.png"
  convert "/tmp/$name.png" -alpha extract -background white -alpha shape -define png:color-type=4 "$name-mask.png"
  rm -f "/tmp/$name.png"
  echo "$name-mask.png $(stat -c %s "$name-mask.png") bytes"
done
