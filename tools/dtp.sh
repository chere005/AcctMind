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

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "refusing: uncommitted tracked changes — commit your work first, so the" >&2
  echo "tag names exactly what shipped:" >&2
  git status --porcelain --untracked-files=no | sed 's/^/  /' >&2
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  git pull --autostash --quiet
fi

if [ "$FULL" = 1 ]; then
  echo "==> tdtp: the full run, before anything is touched"
  npm test || { echo "the full run failed — nothing shipped" >&2; exit 1; }
fi

# ------------------------------------------------------------------ the version
CUR=$(node -p "require('./package.json').version")
case "$CUR" in
  *[!0-9.]*|.*|*.|*..*) echo "package.json version '$CUR' is not x.y.z" >&2; exit 1 ;;
esac

if git rev-parse -q --verify "refs/tags/$CUR" >/dev/null; then
  NEW=$(echo "$CUR" | awk -F. '{printf "%d.%d.0", $1, $2+1}')
  echo "==> version: $CUR (tagged) -> $NEW, build number restarts at 1"
else
  NEW="$CUR"
  echo "==> version: $CUR is still untagged from an earlier run — reusing it"
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
fi

if command -v cargo >/dev/null 2>&1; then
  (cd desktop/src-tauri && cargo update -p acctmind-desktop --quiet)
else
  echo "   (no cargo on PATH — Cargo.lock will catch up on the next desktop build)"
fi

echo "==> proving the bump (check-version.mjs)"
node tools/check-version.mjs || { echo "the bump left the versions disagreeing — fix before shipping" >&2; exit 1; }
[ "$(node -p "require('./package.json').version")" = "$NEW" ] \
  || { echo "guard: package.json does not carry $NEW" >&2; exit 1; }

if ! git diff --quiet -- package.json apps/app/package.json apps/app/app.config.js \
    desktop/package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock; then
  git add package.json apps/app/package.json apps/app/app.config.js \
    desktop/package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock
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
git push --follow-tags origin main
echo "==> pushed, tagged $NEW"

if command -v gh >/dev/null 2>&1; then
  gh workflow run desktop-windows \
    && echo "==> desktop-windows dispatched (CI builds the pushed tree)" \
    || echo "   WARNING: desktop-windows dispatch failed — run it from the Actions tab" >&2
fi

echo "==> dtp done: $NEW is live on test and prod"
