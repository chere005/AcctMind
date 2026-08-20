#!/bin/sh
# Deploy AcctMind — the gates, the export, and the upload.
#
# Sean, 2026-08-20: deploy to BOTH the sandbox and production, and keep doing
# that until he says to switch to test-only. So the default run writes both,
# sandbox first. When that day comes, the change is one line: drop PROD from
# INSTANCES below, and the guards already refuse everything else.
#
# Usage: ./deploy.sh [--quick] [--test-only] [--prod-only] [--dry-run] [--verify]
#   --quick      the fast lane for a small fix: every gate that costs seconds
#                (typechecks, core, server) plus a spot test, instead of the
#                full gesture run. A failure here still fails the deploy.
#   --test-only  the sandbox alone
#   --prod-only  production alone
#   --dry-run    preview every transfer, touch nothing
#   --verify     read-only: ask both instances what they are serving
#
# The rules, carried from CalMind's suite and not up for rediscovery:
#   · never --delete            (a mistake here is unrecoverable)
#   · never send a config       (deploy.conf and the suite's config.php)
#   · never touch a data dir    (nothing this repo writes lives in one)
#   · never ship an index.html  (Apache would serve it INSTEAD of index.php
#                                and hand out the app with no sign-in)

set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

QUICK=0; DRY=""; VERIFY=0; WANT="both"
for a in "$@"; do
  case "$a" in
    --quick)     QUICK=1 ;;
    --test-only) WANT="test" ;;
    --prod-only) WANT="prod" ;;
    --dry-run)   DRY="--dry-run" ;;
    --verify)    VERIFY=1 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------- the destinations
#
# Constants, one per instance, each checked on its own below. Everything that
# names a path DERIVES from these, so there is one place to look and no second
# copy to drift — in CalMind, a separately hardcoded icon href kept pointing at
# the old instance long after the destination moved.
TEST_WEB="/home/public/test/AcctMind"
TEST_SHELL_DIR="/home/protected/acctmind-test"
TEST_PATH="/test/AcctMind/"

PROD_WEB="/home/public/AcctMind"
PROD_SHELL_DIR="/home/protected/acctmind"
PROD_PATH="/AcctMind/"

# The guards run BEFORE deploy.conf is read, deliberately: they are about
# these constants and nothing else, so tools/check-deploy-guards.sh can prove
# them on a machine with no SSH_DEST and no network. A guard that can only be
# exercised by someone holding the production credentials is a guard nobody
# exercises.
#
# `if`, not `[ … ] && { … }`: under `set -e` that form is a list whose status
# is the test's, so the ordinary case — the test being false, which is every
# correct run — is a non-zero list, and whether that ends the script is a
# question about which /bin/sh you are on. A deploy script should not have one
# of those in it.
guard_web() {
  # DEFAULT DENY. Exactly two paths are writable and everything else is
  # refused — including the site root, and including the other applications
  # that share this host, which this repo must never touch.
  #
  # An allow-list rather than a list of forbidden paths, deliberately: a
  # deny-list only refuses the mistakes somebody thought of, and the one that
  # matters is always the one nobody thought of. The site root is called out
  # separately only because it is worth its own sentence.
  if [ "$1" = "/home/public" ]; then
    echo "guard: that is the site root" >&2; exit 1
  fi
  case "$1" in
    /home/public/AcctMind|/home/public/test/AcctMind) ;;
    *) echo "guard: '$1' is not one of this app's two web roots — refusing" >&2; exit 1 ;;
  esac
}
guard_shell() {
  case "$1" in
    /home/protected/acctmind|/home/protected/acctmind-test) ;;
    *) echo "guard: not an AcctMind shell dir ($1)" >&2; exit 1 ;;
  esac
}
guard_web "$TEST_WEB"; guard_web "$PROD_WEB"
guard_shell "$TEST_SHELL_DIR"; guard_shell "$PROD_SHELL_DIR"

# Sandbox first, always: if one of them is going to break, it should be the
# one nobody is using.
case "$WANT" in
  both) INSTANCES="test prod" ;;
  test) INSTANCES="test" ;;
  prod) INSTANCES="prod" ;;
esac

# ------------------------------------------------------------------ the login
if [ ! -f "$ROOT/deploy.conf" ]; then
  echo "no deploy.conf — cp deploy.conf.sample deploy.conf and set SSH_DEST" >&2
  exit 1
fi
. "$ROOT/deploy.conf"
if [ -z "${SSH_DEST:-}" ]; then echo "deploy.conf sets no SSH_DEST" >&2; exit 1; fi
# The site's own address lives in the config too, so this repo names no host.
# It is only used to PROVE a deploy landed; where files are written is decided
# by the guarded constants above and never by anything read from a file.
if [ -z "${SITE_URL:-}" ]; then echo "deploy.conf sets no SITE_URL" >&2; exit 1; fi
SITE_URL="${SITE_URL%/}"

# ------------------------------------------------------------------- --verify
if [ "$VERIFY" = "1" ]; then
  for inst in $INSTANCES; do
    case "$inst" in
      test) url="$SITE_URL$TEST_PATH" ;;
      prod) url="$SITE_URL$PROD_PATH" ;;
    esac
    echo "==> [$inst] $url"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || echo "---")
    echo "    page:  HTTP $code  (401 is correct — it is asking you to sign in)"
    echo "    build: $(curl -s "${url}build.json" | tr -d '\n' || echo unreachable)"
  done
  exit 0
fi

# -------------------------------------------------------------------- the gates
#
# Everything that costs seconds runs on every deploy, quick or not. Each has
# been watched failing on purpose; a guard nobody has seen fire is a guard
# nobody should trust.
echo "==> typechecks"
npm run -s typecheck

echo "==> core"
npm run -s test:core -- --reporter=dot

echo "==> server"
npm run -s test:server

if [ "$QUICK" = "1" ]; then
  # The fast lane still runs a browser, just not all of it: the spine of the
  # app against the real export. A quick deploy that skips every browser check
  # is not a quick deploy, it is an unverified one.
  echo "==> spot test (--quick)"
  ACCTMIND_BASE_URL=/AcctMind npm run -s export:web > /dev/null
  npx playwright test --project=chromium e2e/add.spec.ts
else
  echo "==> gestures (full)"
  ACCTMIND_BASE_URL=/AcctMind npm run -s export:web > /dev/null
  npx playwright test
fi

# --------------------------------------------------------------------- upload
for inst in $INSTANCES; do
  case "$inst" in
    test) WEB="$TEST_WEB"; SHELL_DIR="$TEST_SHELL_DIR"; URL="$SITE_URL$TEST_PATH"; BASE="/test/AcctMind" ;;
    prod) WEB="$PROD_WEB"; SHELL_DIR="$PROD_SHELL_DIR"; URL="$SITE_URL$PROD_PATH"; BASE="/AcctMind" ;;
  esac
  guard_web "$WEB"; guard_shell "$SHELL_DIR"

  echo ""
  echo "==> [$inst] exporting for $BASE"
  # Per instance, because experiments.baseUrl is baked into the asset links.
  # Today that means index.html alone — the bundle is byte-identical, this
  # app having no async chunks yet — but index.html is the file served, and
  # the first lazy import puts the path into the JS too.
  ACCTMIND_BASE_URL="$BASE" npm run -s export:web > /dev/null

  built=$(node -e "process.stdout.write(require('$ROOT/apps/app/dist/build.json').baseUrl)")
  if [ "$built" != "$BASE" ]; then
    echo "guard: the export says it is for '$built', not '$BASE'" >&2; exit 1
  fi

  echo "==> [$inst] shell -> $SHELL_DIR/app.html"
  ssh "$SSH_DEST" "mkdir -p $SHELL_DIR $WEB"
  # The shell goes OUTSIDE the web root. Nothing serves it but index.php.
  rsync -avL $DRY "$ROOT/apps/app/dist/index.html" "$SSH_DEST:$SHELL_DIR/app.html"

  echo "==> [$inst] assets -> $WEB/"
  # --exclude index.html is the important one: an index.html in the web root
  # is served by Apache AHEAD of index.php, which hands out the app with no
  # sign-in at all. No --delete, ever.
  rsync -avL $DRY --exclude 'index.html' "$ROOT/apps/app/dist/" "$SSH_DEST:$WEB/"

  echo "==> [$inst] doorway -> $WEB/"
  rsync -avL $DRY "$ROOT/server/public/index.php" "$SSH_DEST:$WEB/index.php"
  rsync -avL $DRY "$ROOT/server/public/.htaccess" "$SSH_DEST:$WEB/.htaccess"

  if [ -z "$DRY" ]; then
    # Belt and braces, on the server itself: prove the bypass is not there.
    if ssh "$SSH_DEST" "test -f $WEB/index.html"; then
      echo "guard: an index.html is in $WEB — Apache will serve it INSTEAD of the doorway" >&2
      exit 1
    fi

    echo "==> [$inst] proving the page it now serves"
    code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || echo "---")
    if [ "$code" != "401" ] && [ "$code" != "200" ]; then
      echo "guard: $URL answered $code — expected 401 (sign in) or 200 (already signed in)" >&2
      exit 1
    fi
    served=$(curl -s "${URL}build.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).baseUrl)}catch{process.stdout.write('unreadable')}})")
    if [ "$served" != "$BASE" ]; then
      echo "guard: $URL is serving a bundle built for '$served'" >&2; exit 1
    fi
    echo "    $URL — HTTP $code, serving the $served build"
  fi
done

echo ""
echo "done: $INSTANCES"
