#!/bin/sh
# Every raster in the project, from one vector.
#
#   sh tools/make-icons.sh
#
# `assets/logo.svg` is the only source of truth for the mark. Nothing else is
# drawn by hand, and no PNG in this repo should ever be edited directly —
# re-run this instead, so a change to the mark reaches all six surfaces at
# once and none of them drifts.
#
# WHY HEADLESS CHROME. This machine has no rsvg-convert, ImageMagick, Inkscape
# or cairosvg, and adding one as a build dependency for an icon is a poor
# trade. Chrome is already here (it is what the e2e suite drives), it renders
# SVG exactly as a browser does — which is exactly how the mark will be seen
# on the web anyway — and it can be told a precise pixel size. The page is
# sized to the canvas with zero margin so the screenshot is the artwork and
# nothing else.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SRC="$ROOT/assets/logo.svg"          # rounded cut: web, favicon, marketing
SQ="$ROOT/assets/logo-square.svg"    # full-bleed cut: every APP icon
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -f "$SRC" ] || { echo "no assets/logo.svg" >&2; exit 1; }
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME — needed to rasterize the SVG" >&2; exit 1; }

TMP="${TMPDIR:-/tmp}/acctmind-icons-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# $1 = pixel size, $2 = destination, $3 = source svg (defaults to the rounded cut)
render() {
  size="$1"; dest="$2"; src="${3:-$SRC}"
  mkdir -p "$(dirname "$dest")"
  cat > "$TMP/page.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block;width:${size}px;height:${size}px}
</style>
$(cat "$src")
HTML
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --screenshot="$TMP/out.png" --window-size="$size,$size" \
    "file://$TMP/page.html" > /dev/null 2>&1
  [ -f "$TMP/out.png" ] || { echo "Chrome produced nothing at ${size}px" >&2; exit 1; }
  mv "$TMP/out.png" "$dest"
  printf '  %-46s %s\n' "$dest" "${size}x${size}"
}

echo "==> app icons (full-bleed cut — the OS applies its own mask)"
render 1024 "$ROOT/assets/icon.png"                    "$SQ"
render 1024 "$ROOT/apps/app/assets/icon.png"           "$SQ"
render 1024 "$ROOT/apps/app/assets/adaptive-icon.png"  "$SQ"
# The watch target's own; @bacons/apple-targets reads it from there.
render 1024 "$ROOT/apps/app/targets/watch/icon.png"    "$SQ"

echo "==> picture cuts (rounded — nothing masks these)"
render 512  "$ROOT/assets/logo-512.png"
render 48   "$ROOT/apps/app/assets/favicon.png"

echo "==> desktop icon set (icns / ico / png)"
npx --yes @tauri-apps/cli icon "$ROOT/assets/icon.png" -o "$ROOT/desktop/src-tauri/icons" > /dev/null 2>&1
# Expo generates the phone icons and this project builds no Windows Store
# package, so the Square*/StoreLogo set and the android/ios folders the
# generator emits are dead weight. Removing them keeps the repo honest about
# what it actually ships.
rm -rf "$ROOT/desktop/src-tauri/icons/android" "$ROOT/desktop/src-tauri/icons/ios"
rm -f  "$ROOT/desktop/src-tauri/icons/Square"*Logo.png "$ROOT/desktop/src-tauri/icons/StoreLogo.png"
ls "$ROOT/desktop/src-tauri/icons" | sed 's/^/  desktop\/src-tauri\/icons\//'

echo "==> done"
