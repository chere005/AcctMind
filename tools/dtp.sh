#!/bin/sh
# dtp — deploy, tag, push. The release gesture for AcctMind.
# tdtp — the same lane with the full test run in front: tools/tdtp.sh, which
# calls this with --full. (Sean's shorthand, 2026-08-22: dtp = deploy, tag,
# push; tdtp = test, deploy, tag, push. This supersedes the earlier
# one-lane write-down in AGENTS.md's Shorthand — see that entry.)
#
# What a run does, in order:
#   0. refuse a tree with uncommitted TRACKED changes — the tag must name
#      exactly what shipped — and refuse core DRIFT (the gate below)
#   1. (--full only) `npm test` — typecheck, core, peer, version, server,
#      deploy guards, and the full gesture run, before anything is touched
#   2. bump the MINOR version (x.y.0 → x.(y+1).0) in the six files
#      tools/check-version.mjs holds together, restart ios.buildNumber at 1
#      (its own rule: the build number restarts with the version), let
#      Cargo.lock follow the crate, PROVE it with check-version.mjs, and
#      commit the bump. UNLESS the current version is still untagged — a
#      previous run failed before tagging — in which case that version is
#      reused rather than skipped past.
#   3. deploy: ./deploy.sh --quick for dtp, ./deploy.sh (full) for tdtp.
#      Both write the sandbox and then production, running their own gates.
#      A failed deploy stops everything — never tag around one.
#   4. the macOS bundle, from a clean export of what just shipped — BEFORE
#      the tag, so a broken desktop build leaves the version untagged and a
#      re-run reuses it, exactly as a failed deploy does
#   5. tag x.y.0 (annotated, BARE — AcctMind's tags carry no v)
#   6. git push --follow-tags
#   7. dispatch the desktop-windows workflow (CI builds the pushed tree)
#   8. the device builds — iOS on the phone, Android on an emulator — AFTER
#      the push and reported rather than fatal, because the release has
#      already happened and an unplugged phone must not read as a failed one
#
# THIS REPO SHIPS ITSELF. Steps 4 and 8 were CoreMind's alone until
# 2026-08-23 (its bin/build-platforms.sh, the AcctMind row), and the hole
# that left was invisible from inside either repo: a release could tag and
# push with the Mac bundle still built from whatever was lying around —
# ChefMind's did exactly that. Sean, 2026-08-23: "all apps should have a
# deploy on their own mechanism inside their repo". So the machinery is
# tools/build-platforms.sh, HERE, and this lane runs it.
#
# WHICH PLATFORMS: naming one selects only it, naming none means all of them —
# tools/build-platforms.sh's own convention. `--web` is how you say "the
# release and no platform builds".
set -e
cd "$(dirname "$0")/.."

FULL=0; PICKED=0; WANT_MAC=0; WANT_IOS=0; WANT_ANDROID=0
for a in "$@"; do
  case "$a" in
    --full)    FULL=1 ;;
    --mac)     WANT_MAC=1;     PICKED=1 ;;
    --ios)     WANT_IOS=1;     PICKED=1 ;;
    --android) WANT_ANDROID=1; PICKED=1 ;;
    # The release on its own. Not the same as naming no flag at all, which
    # means every platform — this is the way to say none.
    --web)     PICKED=1 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done
# --full is not a platform, so `tdtp` with no other flag still means all three.
[ "$PICKED" = 1 ] || { WANT_MAC=1; WANT_IOS=1; WANT_ANDROID=1; }

# ---------------------------------------------------------------- the branch
# The push below names main explicitly, so a lane run from any other branch
# would deploy and tag a tree it then does not push — while printing
# "pushed" and exiting 0.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "refusing: this lane ships main, and HEAD is on '$BRANCH'" >&2
  exit 1
fi

# ----------------------------------------------------------- the core drift gate
# Refuse to release a tree whose shared files have drifted from CoreMind's
# canon. The gate REFUSES rather than repairs: auto-rewriting source mid-
# release would ship bytes nobody reviewed, so the dependency is made loud
# instead, with the one command that fixes it. Only `exact` rows fail the
# check — `owed` and `fork` rows report and pass, which is check-drift.sh's
# own contract. No CoreMind beside this repo is a warning, not a stop: the
# release must not depend on a second checkout existing.
DRIFTCHECK="${MIND_DIR:-$(cd .. && pwd)}/CoreMind/bin/check-drift.sh"
if [ -f "$DRIFTCHECK" ]; then
  if ! sh "$DRIFTCHECK" AcctMind; then
    echo "" >&2
    echo "refusing: shared files have drifted from CoreMind's canon (rows above)." >&2
    echo "  Nothing has shipped. Bring the copies back in step, then re-run:" >&2
    echo "    sh ../CoreMind/bin/deploy-core.sh --only AcctMind" >&2
    exit 1
  fi
else
  echo "   WARNING: no CoreMind checkout beside this repo — the drift gate did not run" >&2
fi

# ------------------------------------------------------------- the status page
# A SINGLE-REPO RELEASE IS STILL A RELEASE. Sean, 2026-08-23: "i dont see the
# tdtp from ChefMind on status". CoreMind's bin/dtp.sh had reported to
# seancheren.com/status since the page existed; a repo shipping ITSELF did not,
# so the page went quiet for exactly the runs nobody else knew were coming — and
# the history graph recorded no purple for them at all.
#
# NEVER FATAL. report-status.sh exits 0 on every failure path by design, and the
# `|| true` here covers the case where CoreMind is not checked out beside this
# repo at all. A status page must never be the thing that stops a release.
REPORTER="${MIND_DIR:-$(cd .. && pwd)}/CoreMind/bin/report-status.sh"
RUN_ID=""
REPORT_DONE=0
if [ -f "$REPORTER" ]; then
  KIND=dtp; [ "$FULL" = 1 ] && KIND=tdtp
  RUN_ID=$(sh "$REPORTER" start "$KIND" AcctMind 2>/dev/null || true)
  # A lane that dies anywhere — a failed deploy, a refused push, a Ctrl-C —
  # must not leave this repo purple on the page for ever.
  trap 'if [ -n "$RUN_ID" ] && [ "$REPORT_DONE" != 1 ]; then sh "$REPORTER" finish "$RUN_ID" failed 3 "stopped before finishing" >/dev/null 2>&1 || true; fi' EXIT INT TERM
fi

# ------------------------------------------------------- the tree, then a pull
# The dirty check runs FIRST and again AFTER the pull. `git pull --autostash`
# exits 0 even when the autostash pop CONFLICTS — proven, not assumed — so a
# pull that goes first can leave conflict markers in the tree with set -e none
# the wiser, and the lane would deploy them.
refuse_dirty() {
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "refusing: $1" >&2
    git status --porcelain --untracked-files=no | sed 's/^/  /' >&2
    exit 1
  fi
}
refuse_dirty "uncommitted tracked changes — commit your work first, so the tag names exactly what shipped"

if git remote get-url origin >/dev/null 2>&1; then
  git pull --autostash --quiet
  refuse_dirty "the pull left the tree dirty — a conflicted autostash pop exits 0, so this is the check that catches it"
fi

if [ "$FULL" = 1 ]; then
  echo "==> tdtp: the full run, before anything is touched"
  npm test || { echo "the full run failed — nothing shipped" >&2; exit 1; }
fi

# ------------------------------------------------------------------ the version
CUR=$(node -p "require('./package.json').version")
# x.y.z, three digit parts, nothing else. The glob this replaces claimed to
# reject anything else and accepted '', '1', '1.2' and '1.2.3.4' — and an
# EMPTY version flowed on into `git rev-parse refs/tags/v` and a tag named `v`.
printf '%s\n' "$CUR" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || { echo "package.json version '$CUR' is not x.y.z" >&2; exit 1; }

if git rev-parse -q --verify "refs/tags/$CUR" >/dev/null; then
  NEW=$(echo "$CUR" | awk -F. '{printf "%d.%d.0", $1, $2+1}')
  echo "==> version: $CUR (tagged) -> $NEW, build number restarts at 1"
else
  NEW="$CUR"
  echo "==> version: $CUR is still untagged from an earlier run — reusing it"
fi

# A leftover $NEW would make `git tag -a` fail AFTER the deploy has already
# shipped. Checked HERE, while nothing has been touched yet.
if git rev-parse -q --verify "refs/tags/$NEW" >/dev/null; then
  echo "refusing: the tag $NEW already exists — nothing has shipped yet." >&2
  echo "  It is the residue of an interrupted lane: look at it, then delete it" >&2
  echo "  or move the version on." >&2
  exit 1
fi

# Each substitution is VERIFIED — by check-version.mjs, which exists because
# a sed that matched nothing once shipped a build number nothing had set.
if [ "$NEW" != "$CUR" ]; then
  for F in package.json apps/app/package.json desktop/package.json desktop/src-tauri/tauri.conf.json; do
    perl -i -pe "s|\"version\": \"\Q$CUR\E\"|\"version\": \"$NEW\"|" "$F"
  done
  perl -i -pe "s|version: '\Q$CUR\E'|version: '$NEW'|" apps/app/app.config.js
  perl -i -pe "s|^version = \"\Q$CUR\E\"|version = \"$NEW\"|" desktop/src-tauri/Cargo.toml
  BUILD=$(node -p "require('./apps/app/app.config.js').expo.ios.buildNumber")
  if [ "$BUILD" != "1" ]; then
    perl -i -pe "s|buildNumber: '\Q$BUILD\E'|buildNumber: '1'|" apps/app/app.config.js
  fi
  # PROVEN, not assumed. check-version.mjs asserts the build number EXISTS and
  # (when ios/ is present) matches the plist — never that the restart landed.
  # So this one substitution was the only one in the lane nothing checked,
  # which is precisely the sed-that-matched-nothing class this repo banned
  # after it shipped a build number nothing had set.
  grep -q "buildNumber: '1'" apps/app/app.config.js \
    || { echo "guard: app.config.js does not carry buildNumber '1' after the restart" >&2; exit 1; }
fi

if command -v cargo >/dev/null 2>&1; then
  (cd desktop/src-tauri && cargo update -p acctmind-desktop --quiet)
else
  echo "   (no cargo on PATH — Cargo.lock will catch up on the next desktop build)"
fi

echo "==> proving the bump (check-version.mjs --sources-only)"
# --sources-only: apps/app/ios is prebuild OUTPUT and is stale by definition
# the moment the version moves, so the full check can only fail here. The full
# one still runs in `npm test` — and in tdtp, which runs npm test first.
node tools/check-version.mjs --sources-only \
  || { echo "the bump left the versions disagreeing — fix before shipping" >&2; exit 1; }
if [ -d apps/app/ios ]; then
  echo "    note: apps/app/ios now carries the OLD version — the device step"
  echo "          (tools/build-platforms.sh) detects that and prebuilds fresh."
fi
[ "$(node -p "require('./package.json').version")" = "$NEW" ] \
  || { echo "guard: package.json does not carry $NEW" >&2; exit 1; }

# The lock mirrors these version numbers, and npm rewrites it on the next
# install if they disagree — which lands as "uncommitted tracked changes" in
# the NEXT lane, about a file nobody edited. The diff is bounded here because
# a script that rewrites a 300KB lock deserves a check that it changed only
# what it said it would.
echo "==> package-lock.json"
node tools/sync-lock-versions.mjs
LOCKDIFF=$(git diff --numstat -- package-lock.json | awk '{print $1 + $2}')
if [ -n "$LOCKDIFF" ] && [ "$LOCKDIFF" -gt 30 ]; then
  echo "guard: the lock sync changed $LOCKDIFF lines — that is more than version fields" >&2
  git checkout -- package-lock.json
  exit 1
fi

if ! git diff --quiet -- package.json apps/app/package.json apps/app/app.config.js \
    desktop/package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock package-lock.json; then
  git add package.json apps/app/package.json apps/app/app.config.js \
    desktop/package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock package-lock.json
  git commit -q -m "AcctMind $NEW"
  echo "==> committed the bump"
fi

# ------------------------------------------------------------------- the deploy
if [ "$FULL" = 1 ]; then
  ./deploy.sh
else
  ./deploy.sh --quick
fi

# ------------------------------------------------------------------ the desktop
# It makes its OWN clean export rather than trusting whatever is in
# apps/app/dist by now — the deploy above exports per instance, so what is
# lying there is the last instance's, not necessarily what the shell should
# stage. BEFORE the tag, so a broken desktop build leaves the version
# untagged and a re-run reuses it, exactly as a failed deploy does.
if [ "$WANT_MAC" = 1 ]; then
  if ! sh tools/build-platforms.sh --mac; then
    echo "" >&2
    echo "THE WEB SHIPPED, but the macOS bundle failed — so nothing was tagged." >&2
    echo "  Fix it and re-run: the lane reuses ${NEW}, which is the version" >&2
    echo "  already live." >&2
    exit 1
  fi
fi

# --------------------------------------------------------------- tag, push, CI
git tag -a "$NEW" -m "AcctMind $NEW"
# --atomic, because `git push --follow-tags` is per-ref: when origin/main has
# moved under a long deploy, the TAG lands on the remote while main is
# REJECTED — a published tag for a commit nobody can fetch. Both or neither.
#
# And if it is neither, the local tag comes straight back off. The version is
# then still untagged, so a re-run REUSES it — which is right, because the
# deploy above already shipped exactly these bytes under that number.
if ! git push --atomic --follow-tags origin main; then
  git tag -d "$NEW" >/dev/null
  echo "" >&2
  echo "THE DEPLOY SHIPPED, but the push was rejected — so nothing was tagged." >&2
  echo "  main has moved on the remote. Pull, then re-run: the lane reuses ${NEW}." >&2
  exit 1
fi
echo "==> pushed, tagged $NEW"

if command -v gh >/dev/null 2>&1; then
  gh workflow run desktop-windows \
    && echo "==> desktop-windows dispatched (CI builds the pushed tree)" \
    || echo "   WARNING: desktop-windows dispatch failed — run it from the Actions tab" >&2
fi

# ------------------------------------------------------------- the device builds
# After the push, and NOT fatal. The release is done by here — the web is
# live, the tag is on the remote — so a phone that is not plugged in is a
# thing to be told about, not a failed release to unpick.
#
# One at a time, never in parallel: two heavy build/device processes at once
# has caused real failures on this machine twice.
DEVICE_FAILED=""
if [ "$WANT_IOS" = 1 ]; then
  sh tools/build-platforms.sh --ios || DEVICE_FAILED="$DEVICE_FAILED --ios"
fi
if [ "$WANT_ANDROID" = 1 ]; then
  sh tools/build-platforms.sh --android || DEVICE_FAILED="$DEVICE_FAILED --android"
fi
if [ -n "$DEVICE_FAILED" ]; then
  echo "" >&2
  echo "$NEW IS LIVE AND TAGGED. These device builds did not finish:$DEVICE_FAILED" >&2
  echo "  Re-run just those, once the device is ready:" >&2
  echo "    sh tools/build-platforms.sh$DEVICE_FAILED" >&2
fi

# The page is told how it ended, and with what severity: a live, tagged release
# whose phone build did not run is not a failure, but it is not a clean 0 either.
REPORT_DONE=1
if [ -n "$RUN_ID" ]; then
  if [ -n "$DEVICE_FAILED" ]; then
    sh "$REPORTER" finish "$RUN_ID" ok 2 "$NEW live; device builds pending:$DEVICE_FAILED" >/dev/null 2>&1 || true
  else
    sh "$REPORTER" finish "$RUN_ID" ok 0 "$NEW live" >/dev/null 2>&1 || true
  fi
fi

echo "==> dtp done: $NEW is live on test and prod"
