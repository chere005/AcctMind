#!/usr/bin/env bash
# Stage the web export where the desktop shell can actually load it.
#
# THE BUG THIS EXISTS FOR (inherited from CalMind, which paid for it). The web
# app is exported with a base path — `/AcctMind` — so every asset URL in
# index.html is absolute: `/AcctMind/_expo/static/js/web/index-*.js`. A shell
# that embeds that export and serves it at the ROOT of `tauri://localhost/`
# has no such prefix. The bundle request 404s, Tauri's asset protocol answers
# with index.html instead, and the JS parser meets a `<`:
#
#   SyntaxError: Unexpected token '<'
#
# The macOS app then never renders — while a smoke test that only checks "it
# built, it launched, it survived, it quit" passes every one of its checks.
# All four are true of a window showing an error page.
#
# THE FIX, AND WHY THIS SHAPE. The base path is baked into the JS as well as
# the HTML (it is used to load async chunks at runtime), so rewriting
# index.html alone would still break the moment a lazy chunk loaded. Rewriting
# the bundle would mean the desktop runs bytes no suite ever tested. Instead
# the export is staged UNDER the path it was built for, and the window opens
# it there — not one byte differs from what the website serves.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/apps/app/dist"
STAGE="$ROOT/desktop/dist-desktop"

[ -f "$DIST/index.html" ] || { echo "no export at $DIST — run: npm run export:web" >&2; exit 1; }
[ -f "$DIST/build.json" ] || { echo "no build.json — use npm run export:web, not a bare expo export" >&2; exit 1; }

# Read the base out of the EXPORT's own stamp rather than out of a config.
# The config says what the next export will be; the stamp says what this one
# IS, and this one is what we are about to ship. check-assets.sh holds the
# window `url` in tauri.conf.json to the same value.
# `cd` first, and require a RELATIVE path. Handing node an absolute path built
# by the shell breaks on Windows: under Git Bash `pwd` yields an MSYS path
# (/d/a/AcctMind/...), node resolves that as a Windows path off the drive root,
# and the CI build died with MODULE_NOT_FOUND naming a file that is plainly
# there. A relative require resolves against node's own cwd, which every shell
# hands it correctly.
BASE="$(cd "$DIST" && node -e "process.stdout.write(require('./build.json').baseUrl.replace(/^\//,''))")"
[ -n "$BASE" ] || { echo "the export's build.json names no baseUrl" >&2; exit 1; }

rm -rf "$STAGE"
mkdir -p "$STAGE/$BASE"
# -a so the copy is exact: the smoke test matches the app's embedded bundle
# name against apps/app/dist, which only means anything if this is a copy
# rather than a second export.
cp -a "$DIST/." "$STAGE/$BASE/"

echo "staged $(cd "$STAGE" && find . -type f | wc -l | tr -d ' ') files under $BASE/"
