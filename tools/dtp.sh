#!/bin/sh
# dtp — deploy, tag, push. The release gesture for AcctMind.
# tdtp — the same lane with the full test run in front: tools/tdtp.sh, which
# calls this with --full. (Sean's shorthand, 2026-08-22: dtp = deploy, tag,
# push; tdtp = test, deploy, tag, push. This supersedes the earlier
# one-lane write-down in AGENTS.md's Shorthand — see that entry.)
#
# What a run does, in order:
#   0. refuse a tree with uncommitted TRACKED changes — the tag must name
#      exactly what shipped
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
#   4. tag x.y.0 (annotated, BARE — AcctMind's tags carry no v)
#   5. git push --follow-tags
#   6. dispatch the desktop-windows workflow (CI builds the pushed tree)
set -e
cd "$(dirname "$0")/.."

FULL=0
for a in "$@"; do
  case "$a" in
    --full) FULL=1 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------- the branch
# The push below names main explicitly, so a lane run from any other branch
# would deploy and tag a tree it then does not push — while printing
# "pushed" and exiting 0.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "refusing: this lane ships main, and HEAD is on '$BRANCH'" >&2
  exit 1
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
  echo "    note: apps/app/ios now carries the OLD version — a device build needs"
  echo "          \`expo prebuild\` first. This lane ships the web."
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

echo "==> dtp done: $NEW is live on test and prod"
