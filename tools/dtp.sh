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
#      Both write the sandbox and then production, running their own gates —
#      tdtp's without a second full gesture run when its export is the one
#      step 1 just passed, byte for byte (see "the gesture verdict" below).
#      A failed deploy stops everything — never tag around one.
#   4. the macOS bundle, from a clean export of what just shipped — BEFORE
#      the tag, so a broken desktop build leaves the version untagged and a
#      re-run reuses it, exactly as a failed deploy does
#   5. PREFLIGHT (tools/preflight.sh), right before the tag: the Release
#      workflow's real jobs (Windows msi/exe build and smoke, macOS dmg
#      build) run on GitHub against the commit about to be tagged, without
#      failing the run and without publishing. Red = nothing is tagged and a
#      re-run reuses the version, exactly as for step 4. --skip-preflight
#      leaves it out.
#   6. tag x.y.0 (annotated, BARE — AcctMind's tags carry no v)
#   7. git push --follow-tags
#   8. the tag push starts the Release workflow (.github/workflows/release.yml):
#      this lane finds that run, watches it, and reports its URL and the
#      published release's. A Release failure here does NOT un-ship the
#      deploy: it is reported loudly with the exact re-run command and the
#      lane ends non-zero, like an owed device build
#   9. the device builds — iOS on the phone, Android on an emulator — AFTER
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

FULL=0; PICKED=0; WANT_MAC=0; WANT_IOS=0; WANT_ANDROID=0; SKIP_PREFLIGHT=0
for a in "$@"; do
  case "$a" in
    --full)    FULL=1 ;;
    # Not a platform either: leaves out the GitHub preflight before the tag.
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
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

# The Release workflow is started by the tag push and watched with gh; the preflight needs gh too. Found out HERE,
# while nothing has shipped, rather than after the deploy.
if ! command -v gh >/dev/null 2>&1; then
  if [ "$SKIP_PREFLIGHT" = 1 ]; then
    echo "   WARNING: no gh CLI - the Release run will not be watched; look at the Actions tab" >&2
  else
    echo "refusing: the gh CLI is not installed, so the preflight cannot run and the Release run cannot be watched." >&2
    echo "  Install and log in to gh, or pass --skip-preflight and watch the Release run on GitHub by hand." >&2
    exit 1
  fi
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
# A BATCH OWNS ITS OWN CARD. When CoreMind's orchestrator runs this lane as
# part of `dtp all`, it has already opened one run for the whole plan and
# passes its id down — reporting again would draw a second card for a job that
# is one job (Sean, 2026-08-23: "there should be one card per tdtp if multiple
# jobs are triggered in one batch"). Run alone, MIND_RUN_ID is unset and this
# lane opens and closes its own, exactly as before.
REPORTER="${MIND_DIR:-$(cd .. && pwd)}/CoreMind/bin/report-status.sh"
RUN_ID=""
REPORT_DONE=0
# DEFINED OUT HERE, not inside the branch below. It is called at the foot
# of the lane unconditionally, and under CoreMind's batch MIND_RUN_ID is
# set so that branch never runs — "beat_stop: command not found" then made
# a lane that had shipped, tagged, pushed and installed exit non-zero, and
# the batch read that back as "a platform build did not finish" for every
# repo in the suite (2026-09-18). The sandbox lanes carried this shape
# already; this is the copy-across.
BEAT_PID=""
PHASE_FILE=""
# ERREXIT-PROOF, and it was not. The first shape — `[ -n "$BEAT_PID" ] &&
# { kill …; wait …; }` — puts the brace group LAST in an AND list, which is
# the one place `set -e` still applies; `wait` on a process just killed
# returns 143, the lane died right there, AFTER the push and BEFORE the
# status finish, and the EXIT trap re-entered this function and died the
# same way — so every standalone lane since the beat arrived (2026-09-06)
# ended 1 with its card stuck purple at "running". Found by TestAcctMind's
# first qdtp, 2026-09-15; `|| true` on both, and `if` instead of the list.
beat_stop() {
  if [ -n "$BEAT_PID" ]; then
    kill "$BEAT_PID" >/dev/null 2>&1 || true
    wait "$BEAT_PID" 2>/dev/null || true
    BEAT_PID=""
  fi
  if [ -n "$PHASE_FILE" ]; then
    rm -f "$PHASE_FILE"
    PHASE_FILE=""
  fi
  return 0
}
# THE LANE'S WAY OUT, on EXIT and on a signal alike, and the one place the
# card is closed `failed`. EXACTLY ONCE: REPORT_DONE goes to 1 BEFORE the
# reporter runs, so the EXIT after a signal, a second ^C, and the foot of the
# lane all find the card already closed.
lane_stopped() {
  beat_stop
  if [ -n "$RUN_ID" ] && [ "$REPORT_DONE" != 1 ]; then
    REPORT_DONE=1
    sh "$REPORTER" finish "$RUN_ID" failed 3 "stopped before finishing" >/dev/null 2>&1 || true
  fi
  return 0
}

if [ -f "$REPORTER" ] && [ -z "${MIND_RUN_ID:-}" ]; then
  KIND=dtp; [ "$FULL" = 1 ] && KIND=tdtp
  RUN_ID=$(sh "$REPORTER" start "$KIND" AcctMind 2>/dev/null || true)
  # A lane that dies anywhere — a failed deploy, a refused push, a Ctrl-C —
  # must not leave this repo purple on the page for ever.
  #
  # AND A CTRL-C MUST END IT. This was one trap for EXIT, INT and TERM, and a
  # signal trap that returns RESUMES the script: ^C during the iOS build killed
  # xcodebuild, closed the card `failed`, and the lane went straight on into
  # the Android build and then closed the same card again, `ok` (found
  # 2026-10-01). So INT and TERM close the card and then die of their own
  # signal, as an untrapped shell would. A caller then sees "killed by SIGINT"
  # and stops too; `exit 130` would read to it as a child that handled the ^C,
  # and it would carry on. tools/heavy-lock.sh's handler ends the same way.
  trap 'lane_stopped' EXIT
  trap 'lane_stopped; trap - EXIT INT; kill -s INT $$; exit 130' INT
  trap 'lane_stopped; trap - EXIT TERM; kill -s TERM $$; exit 143' TERM
  # A BEAT A MINUTE — Sean, 2026-09-07: "make sure during dtp that status is
  # updated every minute at least". start/finish alone leave the card frozen at
  # "running" through a multi-minute build; a beat every 60s keeps the page
  # showing the run alive, and a hung run then shows as a stamp that stops
  # moving. Only when this lane OWNS the run — under `dtp all` the parent beats.
  #
  # WHAT THE BEAT SAYS comes from a file, not a constant, so that a build
  # step waiting for the suite's heavy-build lock (tools/heavy-lock.sh)
  # can say so: the helper writes "waiting for the heavy-build lock, held by
  # …" into MIND_PHASE_FILE while it waits and puts this line back when it
  # has the lock. Without it a lane queued behind another session's
  # xcodebuild read "shipping" on the card for the whole wait. CoreMind's
  # batch does the same with its own file, and under it this branch never
  # runs, so the batch's MIND_PHASE_FILE is the one inherited. A file that
  # cannot be made or is empty only means the beat says "shipping", as
  # before — never a stopped lane.
  if [ -n "$RUN_ID" ]; then
    PHASE_FILE=$(mktemp -t acctmind-phase 2>/dev/null) || PHASE_FILE=""
    if [ -n "$PHASE_FILE" ] && printf '%s' "shipping — $KIND" >"$PHASE_FILE" 2>/dev/null; then
      MIND_PHASE_FILE="$PHASE_FILE"; export MIND_PHASE_FILE
    fi
    ( while :; do
        sleep 60
        MSG=$(cat "$PHASE_FILE" 2>/dev/null) || MSG=""
        [ -n "$MSG" ] || MSG="shipping — $KIND"
        sh "$REPORTER" beat "$RUN_ID" "$MSG" >/dev/null 2>&1 || true
      done ) &
    BEAT_PID=$!
  fi
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

# THE GESTURE VERDICT, CARRIED TO THE DEPLOY. tdtp's npm test runs the full
# gesture suite on a fresh export, and deploy.sh's full gate used to run all
# of it again on ITS fresh export — the same bytes, since the bump below
# moves nothing in the web bundle: about two minutes spent sampling one thing
# twice. So the verdict is keyed by tools/dist-key.mjs (the export's bytes,
# the suite's own files, the Playwright and node that ran it, the settings it
# reads), and deploy.sh skips its repeat only when its own export keys the
# same. Any difference — a mid-lane source edit, a version string that one
# day lands in the bundle, an edited spec — and the suite runs again.
#
# ONLY THIS LANE'S VERDICT. The key lives in the environment, never on disk,
# prefixed with this shell's pid, which deploy.sh compares against its own
# parent's: an export left in a terminal, or a value inherited from whoever
# started this lane, cannot stand in for a run that happened here — and the
# unset below makes sure nothing inherited is even looked at.
#
# AND ONLY THE BYTES IT RAN ON. The key can only be taken after npm test,
# so an export or a spec edited while the suite ran would otherwise be keyed
# as passed. Every process of the run writes the key it STARTS on into a
# receipt (e2e/freshness.ts, only when ACCTMIND_GESTURES_SEEN names one), and
# the verdict is carried only if every line equals the key at the end.
#
# AND ONLY WHEN THE SUITE SERVED ITSELF. playwright.config.ts REUSES whatever
# already answers on its port (reuseExistingServer outside CI), so a server
# left up there — another checkout's e2e/serve.mjs, say — would have been
# what the suite drove, and its verdict is about that server's bytes, not
# these. The port must refuse a connection before npm test and again after
# it, or nothing is carried and deploy.sh runs the whole suite, as it always
# did. Read from the config, so the two cannot drift apart.
unset ACCTMIND_GESTURES_GREEN
e2e_port_free() {
  _port=$(sed -n 's/^const PORT = \([0-9][0-9]*\);.*/\1/p' playwright.config.ts)
  [ -n "$_port" ] || return 1
  node -e "require('net').connect($_port, '127.0.0.1').on('connect', () => process.exit(1)).on('error', (e) => process.exit(e.code === 'ECONNREFUSED' ? 0 : 1)).setTimeout(3000, () => process.exit(1))"
}

if [ "$FULL" = 1 ]; then
  echo "==> tdtp: the full run, before anything is touched"
  E2E_FREE=0
  if e2e_port_free; then E2E_FREE=1; fi
  # The receipt: every process of the gesture run writes the key it STARTED
  # on (e2e/freshness.ts), because the key below can only be taken after.
  SEEN=$(mktemp -t acctmind-gestures-seen 2>/dev/null) || SEEN=""
  ACCTMIND_GESTURES_SEEN="$SEEN" npm test || { [ -z "$SEEN" ] || rm -f "$SEEN"; echo "the full run failed — nothing shipped" >&2; exit 1; }
  CARRY=""
  if [ "$E2E_FREE" != 1 ] || ! e2e_port_free; then
    CARRY="something else answered on the suite's port, so the suite may have driven that"
  elif ! GESTURES_KEY=$(node tools/dist-key.mjs apps/app/dist); then
    CARRY="the export could not be keyed"
  elif [ -z "$SEEN" ] || [ "$(sort -u "$SEEN" 2>/dev/null)" != "$GESTURES_KEY" ]; then
    CARRY="the run's receipt does not show it starting on these bytes (an export or a spec changed while it ran, or no receipt was written)"
  fi
  [ -z "$SEEN" ] || rm -f "$SEEN"
  if [ -z "$CARRY" ]; then
    ACCTMIND_GESTURES_GREEN="$$:$GESTURES_KEY"
    export ACCTMIND_GESTURES_GREEN
    echo "==> gestures passed on export key $(printf '%.12s' "$GESTURES_KEY"); deploy.sh repeats them only if its own export keys differently"
  else
    echo "==> the gesture verdict is NOT carried to the deploy: $CARRY — deploy.sh runs the full suite"
  fi
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

# ------------------------------------------------------------------- preflight
# The Release workflow's own jobs, on GitHub, against THIS commit — the one about to be tagged — without a failed job
# failing the run (so GitHub sends no failed-job mail) and without creating or publishing anything. What only a
# Windows or a macOS runner can catch (a typecheck, the msi that will not install, a dmg that will not build) is
# caught here and not in a release. A red preflight is handled like a failed desktop build above: nothing is tagged,
# and a re-run reuses ${NEW}. NEVER tag around it; --skip-preflight is the only way past it, and it is typed.
if [ "$SKIP_PREFLIGHT" = 1 ]; then
  echo "==> preflight SKIPPED (--skip-preflight)"
else
  echo "==> preflight: the Release workflow's jobs against $(git rev-parse --short HEAD), no publishing"
  if ! sh tools/preflight.sh "$NEW"; then
    echo "" >&2
    echo "THE WEB SHIPPED, but the preflight failed — so nothing was tagged." >&2
    echo "  Fix what it named, commit, and re-run: the lane reuses ${NEW}, which is the version" >&2
    echo "  already live. (--skip-preflight goes past it; do that only knowing why it failed.)" >&2
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

# ------------------------------------------------------------ the Release run
# The tag push started .github/workflows/release.yml: it builds the Windows msi and exe and the macOS dmg, attaches
# them to ONE draft release and publishes it when every file is there. This finds that run, watches it, and says
# where the release is. NOT FATAL TO THE SHIP: the deploy and the tag are done, so a Release that fails is reported
# loudly with the command that re-runs it, and the lane ends non-zero for it (below), like an owed device build.
RELEASE_FAILED=""
if command -v gh >/dev/null 2>&1; then
  RELEASE_RUN=""
  # Two minutes of slack on the clock (this machine has run ~17 s ahead of GitHub's); the run is still this tag's, this
  # commit's, from a push. GNU date first, BSD (macOS) second.
  SINCE=$(date -u -d '-120 seconds' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-120S +%Y-%m-%dT%H:%M:%SZ)
  HEADSHA=$(git rev-parse HEAD)
  for _ in $(seq 1 30); do
    RELEASE_RUN=$(gh run list --workflow release.yml --event push --branch "$NEW" --limit 10 \
      --json databaseId,headSha,createdAt \
      --jq "[.[] | select(.headSha == \"$HEADSHA\" and .createdAt >= \"$SINCE\")][0].databaseId // empty" 2>/dev/null | tr -d '\r') || RELEASE_RUN=""
    [ -n "$RELEASE_RUN" ] && break
    sleep 4
  done
  if [ -z "$RELEASE_RUN" ]; then
    RELEASE_FAILED="the Release run for $NEW did not appear"
    echo "" >&2
    echo "WARNING: $RELEASE_FAILED. Look at the Actions tab; if there is none, start it:" >&2
    echo "    gh workflow run release.yml -f tag=$NEW" >&2
  else
    RELEASE_URL=$(gh run view "$RELEASE_RUN" --json url --jq .url 2>/dev/null | tr -d '\r') || RELEASE_URL=""
    echo "==> Release run: ${RELEASE_URL:-run $RELEASE_RUN} (watching: the Windows and macOS builds take a while)"
    if gh run watch "$RELEASE_RUN" --interval 30 --exit-status >/dev/null 2>&1; then
      echo "==> Release run finished: success"
      gh release view "$NEW" --json url,isDraft --jq '"==> release: \(.url)" + (if .isDraft then " (STILL A DRAFT - publish did not run)" else " (published)" end)' | tr -d '\r' || true
    else
      RELEASE_FAILED="the Release run for $NEW did not succeed"
      echo "" >&2
      echo "THE RELEASE RUN FAILED. $NEW is deployed and tagged; the GitHub release stays a DRAFT (nothing is published)." >&2
      echo "  Run:  ${RELEASE_URL:-gh run view $RELEASE_RUN}" >&2
      echo "  Fix the cause if it is in the code (a new tag is then needed), else re-run what failed:" >&2
      echo "    gh run rerun $RELEASE_RUN --failed" >&2
    fi
  fi
fi

# ------------------------------------------------------------- the device builds
# After the push, and NOT fatal. The release is done by here — the web is
# live, the tag is on the remote — so a phone that is not plugged in is a
# thing to be told about, not a failed release to unpick.
#
# One at a time, never in parallel: two heavy build/device processes at once
# has caused real failures on this machine twice. These two run in turn here,
# and tools/build-platforms.sh's heavy-build lock keeps every OTHER session's
# builds from running beside them (tools/heavy-lock.sh).
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
beat_stop
REPORT_DONE=1
if [ -n "$RUN_ID" ]; then
  if [ -n "$DEVICE_FAILED" ] || [ -n "$RELEASE_FAILED" ]; then
    OWED=""
    [ -z "$DEVICE_FAILED" ] || OWED="device builds pending:$DEVICE_FAILED"
    [ -z "$RELEASE_FAILED" ] || OWED="${OWED:+$OWED; }GitHub release not published"
    sh "$REPORTER" finish "$RUN_ID" ok 2 "$NEW live; $OWED" >/dev/null 2>&1 || true
  else
    sh "$REPORTER" finish "$RUN_ID" ok 0 "$NEW live" >/dev/null 2>&1 || true
  fi
fi

# AND YET THE LANE ENDS NON-ZERO. Nothing above is undone by this: the release
# is live, the tag is on the remote, and the status card was closed `ok`
# severity 2 a few lines up on purpose. What changes is only the one summary a
# caller reads without being told — a run that skipped a device build for want
# of a phone handed back a clean 0, so "it all worked" could be read off an
# exit status that had not checked. CoreMind's bin/dtp.sh has ended non-zero on
# exactly this since it existed, and catches this one so a batch still ships
# every repo after it; ChefMind carried it from 2026-08-23 and the other three
# did not, which meant the SAME condition reported differently per repo.
#
# LAST IN THE FILE, deliberately. REPORT_DONE is already 1 and the `finish`
# call above has run by the time control reaches here, so the exit cannot jump
# the status report and the EXIT trap's failed-3 fallback stays suppressed.
#
# THE GITHUB RELEASE IS THE SAME CASE. A Release run that failed after the tag
# leaves the release a draft that nobody sees; the deploy is not undone, the
# card is `ok` severity 2, and the lane ends non-zero so that is not read as a
# clean ship. The re-run command was printed where it happened.
if [ -n "$DEVICE_FAILED" ] || [ -n "$RELEASE_FAILED" ]; then
  [ -z "$DEVICE_FAILED" ] || echo "==> $NEW is live and tagged; the lane ends non-zero for the device builds above"
  [ -z "$RELEASE_FAILED" ] || echo "==> $NEW is live and tagged; the lane ends non-zero because $RELEASE_FAILED (see above)"
  exit 1
fi

echo "==> dtp done: $NEW is live on test and prod"
