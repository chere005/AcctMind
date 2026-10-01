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

# WHERE A FILE SITS AND WHAT THE WORLD CALLS IT ARE TWO DIFFERENT FACTS.
#
# The sandbox's files live in /home/public/test/AcctMind, and until the site
# moved test and dev onto subdomains (2026-08-20) that was also its address.
# It is not any more: the apex /test/ 404s BY DESIGN, so the URL this script
# built by pasting TEST_PATH onto SITE_URL — https://seancheren.com/test/
# AcctMind/ — is a dead path, and the post-deploy proof failed on a deploy
# that had in fact landed correctly.
#
# CalMind hit this first and its server/deploy.sh carries the same note. It
# hardcodes the subdomain; this repo deliberately names no host, so the host
# is taken from SITE_URL and the label prefixed onto it.
TEST_URL="$(printf '%s' "$SITE_URL" | sed 's|^\(https\{0,1\}://\)|\1test.|')$PROD_PATH"
PROD_URL="$SITE_URL$PROD_PATH"
case "$TEST_URL" in
  https://test.*|http://test.*) ;;
  *) echo "guard: the sandbox URL '$TEST_URL' is not on a test. host" >&2; exit 1 ;;
esac

# ------------------------------------------------------------------- --verify
if [ "$VERIFY" = "1" ]; then
  for inst in $INSTANCES; do
    case "$inst" in
      test) url="$TEST_URL" ;;
      prod) url="$PROD_URL" ;;
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
  # RUN ONCE PER tdtp, NOT TWICE. tools/dtp.sh's --full lane has just run
  # this whole suite in `npm test`, on its own fresh export, and hands this
  # script that verdict as ACCTMIND_GESTURES_GREEN: its own pid, then the
  # tools/dist-key.mjs key of what passed. The repeat is skipped only when
  # THIS export keys the same — every byte of dist, the suite's files, the
  # Playwright and node that ran it, the settings it reads — and only when
  # the verdict was minted by the lane that started this script ($PPID).
  # Anything else, including every standalone ./deploy.sh, runs the suite as
  # it always has. The fresh export above is made either way; when the key
  # matches, it is byte for byte what the suite just passed.
  GESTURES_KEY=""
  if [ -n "${ACCTMIND_GESTURES_GREEN:-}" ]; then
    GESTURES_KEY=$(node tools/dist-key.mjs apps/app/dist) || GESTURES_KEY=""
  fi
  if [ -n "$GESTURES_KEY" ] && [ "$ACCTMIND_GESTURES_GREEN" = "$PPID:$GESTURES_KEY" ]; then
    echo "    passed against these exact bytes in this lane's npm test (key $(printf '%.12s' "$GESTURES_KEY")): not repeated"
  else
    if [ -n "${ACCTMIND_GESTURES_GREEN:-}" ]; then
      echo "    not the export (or not the lane) that npm test passed — running the full suite"
    fi
    npx playwright test
  fi
fi

# ------------------------------------------------------- one SSH connection
# Each instance is four rsyncs and two ssh calls, and each of those used to
# open its own connection to the host: TCP, key exchange, auth and NFSN's
# session setup, about a second or two apiece, a dozen times a deploy. Now
# the first one opens a master and the rest ride it (ControlMaster), which
# changes HOW a command reaches the host and nothing about WHAT it does:
# every ssh and rsync line below is the same line, with the same paths,
# flags and checks, and a master that has gone is replaced by a fresh
# connection, never a failure (ControlMaster=auto).
#
# THIS DEPLOY'S OWN SOCKET, in a private directory made for this run and
# removed with it — never ~/.ssh/config, so no other ssh on this machine
# rides along, and never a fixed path, so a second deploy running at the
# same time cannot have its transfer cut off by this one's `-O exit`. Under
# /tmp, not $TMPDIR: a socket path must fit in 104 bytes, ssh adds 17 more
# while it binds one, and $TMPDIR is 49 on its own here — longer in some
# sessions. If the directory cannot be made, each command connects on its
# own, exactly as before.
#
# HERE and not earlier: the guards above run first, so a broken copy in
# tools/check-deploy-guards.sh refuses before this exists, and every ssh it
# could reach still goes through `command ssh`, the PATH's ssh — the
# neutered stub, in those copies.
SSH_MUX=""
MUX_DIR=$(mktemp -d /tmp/acctmind-ssh.XXXXXX 2>/dev/null) || MUX_DIR=""
if [ -n "$MUX_DIR" ]; then
  SSH_MUX="-o ControlMaster=auto -o ControlPath=$MUX_DIR/m -o ControlPersist=120"
  RSYNC_RSH="ssh $SSH_MUX"
  export RSYNC_RSH
else
  echo "   (could not make a private socket directory — one SSH connection per transfer, as before)"
fi
ssh() { command ssh $SSH_MUX "$@"; }
mux_close() {
  if [ -n "$MUX_DIR" ]; then
    command ssh $SSH_MUX -O exit "$SSH_DEST" >/dev/null 2>&1 || true
    case "$MUX_DIR" in /tmp/acctmind-ssh.*) rm -rf "$MUX_DIR" ;; esac
  fi
  return 0
}
trap mux_close EXIT

# --------------------------------------------------------------------- upload
for inst in $INSTANCES; do
  case "$inst" in
    test) WEB="$TEST_WEB"; SHELL_DIR="$TEST_SHELL_DIR"; URL="$TEST_URL"; BASE="/test/AcctMind" ;;
    prod) WEB="$PROD_WEB"; SHELL_DIR="$PROD_SHELL_DIR"; URL="$PROD_URL"; BASE="/AcctMind" ;;
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
    # ASKED MORE THAN ONCE, deliberately. This proof reads a file rsync has
    # just this second finished writing, and on 2026-09-19 it read one
    # mid-write: build.json came back unparseable, the guard called the whole
    # release "a bundle built for 'unreadable'", and nothing was tagged —
    # though every byte had in fact landed and the very same URL read
    # perfectly a moment later. A guard that turns a half-second race into a
    # blocked release is not guarding anything.
    #
    # It keeps ALL of its teeth: a bundle genuinely built for another base
    # answers the same wrong thing every time, so it still fails, just four
    # seconds later. Only the race is forgiven.
    served=""
    for try in 1 2 3 4 5; do
      served=$(curl -s "${URL}build.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).baseUrl)}catch{process.stdout.write('unreadable')}})")
      [ "$served" = "$BASE" ] && break
      [ "$try" = "5" ] || sleep 1
    done
    if [ "$served" != "$BASE" ]; then
      echo "guard: $URL is serving a bundle built for '$served', asked five times" >&2
      echo "       what it answered last:" >&2
      curl -s "${URL}build.json" | head -c 400 | sed 's/^/         /' >&2
      echo "" >&2
      exit 1
    fi
    echo "    $URL — HTTP $code, serving the $served build"
  fi
done

echo ""
echo "done: $INSTANCES"
