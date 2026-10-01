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
#
#   sh desktop/smoke.sh              build the shell, then every check below
#   sh desktop/smoke.sh --no-build   every check below, on the bundle already
#                                    built — what tools/build-platforms.sh
#                                    runs, straight after its own build
#
# --no-build EXISTS BECAUSE THE LANE COMPILED THE SHELL TWICE. build-platforms
# ran `tauri build`, then called this, which ran `tauri build` again on the
# same staged export: check-assets re-stages dist-desktop (rm -rf and copy),
# so tauri-build's rerun-if-changed fired and the whole crate recompiled —
# 14-18 s on a quiet machine, 74 s under contention, proving nothing the
# first build had not (2026-09-30). The checks are the same either way, and
# they read the binary that build-platforms then installs; CalMind's smoke has
# had the same flag since its lane first called it.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

BUILD=1
for a in "$@"; do
  case "$a" in
    --no-build) BUILD=0 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; if [ -n "$2" ]; then echo "       $2"; fi; }

echo "desktop smoke (macOS)"

# Captured, not piped. `check-assets.sh | sed` took the pipe's status from
# sed, and sh has no pipefail, so every FAIL check-assets printed — the window
# url against the export's base, the 404 this file exists for, and the CSP —
# still ended in a smoke that passed (2026-10-01). The binary check below
# cannot stand in for it: the embedded asset key satisfies its grep whatever
# the window url says. So the indent stays and the status is kept.
if CA=$(sh "$ROOT/desktop/check-assets.sh" 2>&1); then
  printf '%s\n' "$CA" | sed 's/^/  /'
  ok "the desktop assets check passes"
else
  printf '%s\n' "$CA" | sed 's/^/  /'
  bad "the desktop assets check passes" "its own FAIL lines are just above"
fi

if [ "$BUILD" = 1 ]; then
  # A cargo compile is a heavy build, so it waits its turn under the
  # machine-wide lock (tools/heavy-lock.sh says why). The build alone: the
  # launch below is not heavy, and --no-build takes no lock at all, which is
  # what lets tools/build-platforms.sh call this from inside its own.
  . "$ROOT/tools/heavy-lock.sh"
  heavy_lock "desktop smoke build" || exit 1
  echo "==> building"
  (cd "$ROOT/desktop" && npx tauri build --bundles app > "$ROOT/desktop/.smoke-build.log" 2>&1) \
    || { echo "  FAIL the shell builds"; tail -20 "$ROOT/desktop/.smoke-build.log"; exit 1; }
  heavy_unlock
  ok "the shell builds"
else
  # Said out loud, so a log never reads as though this run built anything.
  echo "==> not building (--no-build): checking the bundle the caller just built"
fi

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

# LAUNCHING, AND WHY THIS IS MORE THAN FOUR LINES.
#
# On 2026-09-19 this check failed twice in one evening — "it exited on its
# own" — and blocked the release both times, and the app could not be made to
# fail again afterwards: six launches, one of them under ten busy cores, all
# lived. The check had thrown the app's output into /dev/null and kept no exit
# status, so a crash and a flake read exactly the same and there was nothing
# to act on. Whatever it was, the next one has to leave evidence.
#
# So: the output is kept, the exit status is read and named (a signal is a
# crash, a status is a refusal, and they are different bugs), and a first
# death is retried once. One launch that dies and a second that lives is not a
# broken bundle — it is this check losing a race — and a release should not
# stop for it. Two deaths in a row is the app, and then the log is printed.
LAUNCHLOG="$ROOT/desktop/.smoke-launch.log"
launch_once() {
  : > "$LAUNCHLOG"
  "$BIN" > "$LAUNCHLOG" 2>&1 &
  PID=$!
  sleep 8
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
    return 0
  fi
  # It is already gone; `wait` on a finished child still yields its status.
  wait "$PID" 2>/dev/null
  WHY=$?
  return 1
}

echo "==> launching"
if launch_once; then
  ok "it is still alive after 8 seconds"
  ok "it quits when asked"
else
  FIRST=$WHY
  echo "  ..   it died (${FIRST}) — trying once more before calling it"
  if launch_once; then
    ok "it is still alive after 8 seconds (on the second try; the first died ${FIRST})"
    ok "it quits when asked"
  else
    # 128+n is a signal: 139 segfault, 134 abort, 137 killed.
    if [ "$WHY" -gt 128 ]; then
      bad "it is still alive after 8 seconds" "it CRASHED on signal $((WHY - 128)), twice"
    else
      bad "it is still alive after 8 seconds" "it exited on its own with status $WHY, twice"
    fi
    echo "       what it said (also in desktop/.smoke-launch.log):"
    if [ -s "$LAUNCHLOG" ]; then sed 's/^/         /' "$LAUNCHLOG" | tail -20; else echo "         nothing at all"; fi
  fi
fi

echo ""
echo "$PASS passed, $FAIL failed"
echo "(a render is NOT proven here — see this file's header)"
[ "$FAIL" = "0" ]
