#!/bin/sh
# macOS: build the shell, prove it carries THIS export, launch it, watch it
# survive, quit it.
#
# WHAT THIS PROVES, AND WHAT IT DOES NOT.
#
# It does NOT prove the window rendered. A window showing an error page
# launches, survives and quits exactly like a working one — which is how
# CalMind's macOS shell went a long time never once rendering while its smoke
# passed every check it had. Proving a render needs either screen-recording
# permission (`screencapture`) or a probe build with a beacon in it, and
# neither belongs in a script that has to run unattended.
#
# What it does instead is guard the specific failure that caused that: the
# window opening a path the embedded assets do not have. Tauri 2 compiles the
# frontend INTO the binary, so the asset paths are readable out of it — and
# the check below is that the bundle the export names is embedded at the path
# the window opens. That is the 404 that produced "Unexpected token '<'".
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; if [ -n "$2" ]; then echo "       $2"; fi; }

echo "desktop smoke (macOS)"

sh "$ROOT/desktop/check-assets.sh" | sed 's/^/  /'

echo "==> building"
(cd "$ROOT/desktop" && npx tauri build --bundles app > "$ROOT/desktop/.smoke-build.log" 2>&1) \
  || { echo "  FAIL the shell builds"; tail -20 "$ROOT/desktop/.smoke-build.log"; exit 1; }
ok "the shell builds"

APP="$ROOT/desktop/src-tauri/target/release/bundle/macos/AcctMind.app"
BIN="$APP/Contents/MacOS/acctmind-desktop"
[ -x "$BIN" ] || { bad "the bundle has a binary"; exit 1; }
ok "the bundle has a binary"

# The check that matters. Read what the export names, then read what the
# binary actually carries.
WANT=$(grep -o '_expo/static/js/web/index-[a-z0-9]*\.js' "$ROOT/apps/app/dist/index.html" | head -1)
BASE=$(node -e "process.stdout.write(require('$ROOT/apps/app/dist/build.json').baseUrl)")
if [ -n "$WANT" ] && strings "$BIN" | grep -q "$BASE/$WANT"; then
  ok "the binary embeds the bundle THIS export names, at $BASE/"
else
  bad "the binary embeds the bundle THIS export names" "wanted $BASE/$WANT"
fi
if strings "$BIN" | grep -q "$BASE/index.html"; then
  ok "and the index.html the window opens"
else
  bad "and the index.html the window opens" "the window url and the embedded assets disagree"
fi

echo "==> launching"
"$BIN" > /dev/null 2>&1 &
PID=$!
sleep 8
if kill -0 "$PID" 2>/dev/null; then
  ok "it is still alive after 8 seconds"
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  ok "it quits when asked"
else
  bad "it is still alive after 8 seconds" "it exited on its own"
fi

echo ""
echo "$PASS passed, $FAIL failed"
echo "(a render is NOT proven here — see this file's header)"
[ "$FAIL" = "0" ]
