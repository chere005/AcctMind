#!/bin/sh
# The desktop checks that need no compiler — run them before waiting on Rust.
#
# Every one of these guards the same failure: a shell that builds, launches,
# and shows an error page. Each check is cheap; the build is not.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; if [ -n "$2" ]; then echo "       $2"; fi; }

echo "desktop assets"

if [ ! -f "$ROOT/apps/app/dist/build.json" ]; then
  bad "there is an export to carry" "run: npm run export:web"
  echo ""; echo "$PASS passed, $FAIL failed"; exit 1
fi
ok "there is an export to carry"

BASE=$(node -e "process.stdout.write(require('$ROOT/apps/app/dist/build.json').baseUrl)")
WINURL=$(node -e "process.stdout.write(require('$ROOT/desktop/src-tauri/tauri.conf.json').app.windows[0].url)")

# THE check. The window must open the export at the path the export was built
# for. When these disagree the app opens a 404, Tauri answers it with
# index.html, and the JS parser meets a '<' — a window that renders nothing.
if [ "$WINURL" = "$BASE/index.html" ]; then
  ok "the window opens the export at its own base ($BASE/index.html)"
else
  bad "the window opens the export at its own base" "window: $WINURL, export: $BASE/index.html"
fi

# The staged tree must actually contain that file.
sh "$ROOT/desktop/stage-dist.sh" > /dev/null
if [ -f "$ROOT/desktop/dist-desktop$BASE/index.html" ]; then
  ok "the staged tree has index.html where the window looks for it"
else
  bad "the staged tree has index.html where the window looks for it"
fi

# And the bundle the staged index.html names must be present — the 404 that
# started all this.
BUNDLE=$(grep -o '_expo/static/js/web/index-[a-z0-9]*\.js' "$ROOT/desktop/dist-desktop$BASE/index.html" | head -1)
if [ -n "$BUNDLE" ] && [ -f "$ROOT/desktop/dist-desktop$BASE/$BUNDLE" ]; then
  ok "the bundle index.html names is staged beside it"
else
  bad "the bundle index.html names is staged beside it" "named: ${BUNDLE:-<none found>}"
fi

# The staged copy must be the SAME export, not a second one.
if diff -q "$ROOT/apps/app/dist/index.html" "$ROOT/desktop/dist-desktop$BASE/index.html" > /dev/null; then
  ok "the staged shell is a copy of the export, not a re-export"
else
  bad "the staged shell is a copy of the export, not a re-export"
fi

# No network in the CSP: AcctMind is local-only, and a connect-src that lets
# the desktop talk to a host is a door nothing needs.
if node -e "
const csp = require('$ROOT/desktop/src-tauri/tauri.conf.json').app.security.csp;
const m = /connect-src ([^;]*)/.exec(csp);
process.exit(m && m[1].trim() === \"'self'\" ? 0 : 1);
"; then
  ok "the CSP lets the desktop talk to nothing but itself"
else
  bad "the CSP lets the desktop talk to nothing but itself"
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
