#!/bin/sh
# Prove every guard in deploy.sh by BREAKING A COPY and watching it refuse.
#
# The rule this file exists for, learned in CalMind the expensive way: a run
# that set out to prove the consent gate worked, by removing the consent gate,
# went on to write production. So:
#
#   · every test runs against a COPY in a scratch directory
#   · ssh, rsync, scp, curl and npm/npx are NEUTERED on the PATH first, so a
#     copy that gets past its guard still cannot reach the network
#   · the neutering is installed before the first copy is ever run
#
# A guard nobody has watched fire is a guard nobody should trust.

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

TMP="${TMPDIR:-/tmp}/acctmind-guards-$$"
mkdir -p "$TMP/bin"
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------- the neutering
# Each of these records that it was called and exits 0, so a copy that gets
# further than it should leaves evidence instead of a deploy.
for cmd in ssh rsync scp curl; do
  cat > "$TMP/bin/$cmd" <<EOF
#!/bin/sh
echo "$cmd \$*" >> "$TMP/called.log"
exit 0
EOF
  chmod +x "$TMP/bin/$cmd"
done
# npm/npx would run the real suites — minutes we do not need to spend to learn
# whether a path constant is checked.
for cmd in npm npx node; do
  cat > "$TMP/bin/$cmd" <<EOF
#!/bin/sh
echo "$cmd \$*" >> "$TMP/called.log"
exit 0
EOF
  chmod +x "$TMP/bin/$cmd"
done
PATH="$TMP/bin:$PATH"
export PATH

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; if [ -n "$2" ]; then echo "       $2"; fi; }

# Run a broken copy and require it to refuse with a message that matches.
# $1 label  $2 sed expression  $3 expected message fragment
refuses() {
  copy="$TMP/deploy-copy.sh"
  sed "$2" "$ROOT/deploy.sh" > "$copy"
  chmod +x "$copy"
  # A conf exists so that a copy stopping for want of SSH_DEST cannot be
  # mistaken for the guard under test doing its job.
  echo 'SSH_DEST="nobody@example.invalid"' > "$TMP/deploy.conf"

  # ONE run, inside `if`. Two runs used to be two, and the second was written
  # as `status=$(… ; echo $?)` — which does not work under `set -e`: errexit
  # is inherited by the command substitution's subshell, so the subshell dies
  # at the failing command and never reaches the `echo`. The variable came
  # back empty and the whole check script exited silently after its header.
  # `if` is the construct that suspends errexit for the command it tests.
  if (cd "$TMP" && sh "$copy" --dry-run >"$TMP/out.txt" 2>&1); then
    bad "$1" "it exited 0 — the guard did not fire"
  elif grep -qi "$3" "$TMP/out.txt"; then
    ok "$1"
  else
    bad "$1" "refused, but not for the stated reason: $(head -2 "$TMP/out.txt" | tr '\n' ' ')"
  fi
}

echo "deploy guards (every one proven by breaking a copy)"

# --- the destinations ------------------------------------------------------
refuses "the site root is refused" \
  's|^PROD_WEB=.*|PROD_WEB="/home/public"|' "site root"

# The allow-list has to refuse every neighbour on the host, not just the ones
# somebody remembered to name. These stand in for "another app's area".
refuses "a sibling app's area is refused" \
  's|^PROD_WEB=.*|PROD_WEB="/home/public/otherapp"|' "not one of this app"

refuses "a sibling app's dev area is refused" \
  's|^PROD_WEB=.*|PROD_WEB="/home/public/dev/otherapp"|' "not one of this app"

refuses "a sibling app's sandbox is refused" \
  's|^TEST_WEB=.*|TEST_WEB="/home/public/test/otherapp"|' "not one of this app"

refuses "a near-miss on our own name is refused" \
  's|^PROD_WEB=.*|PROD_WEB="/home/public/AcctMind2"|' "not one of this app"

refuses "a lowercase spelling of our own path is refused" \
  's|^PROD_WEB=.*|PROD_WEB="/home/public/acctmind"|' "not one of this app"

refuses "a sandbox pointed at production is refused" \
  's|^TEST_WEB=.*|TEST_WEB="/home/public"|' "site root"

refuses "a shell dir outside AcctMind's is refused" \
  's|^PROD_SHELL_DIR=.*|PROD_SHELL_DIR="/home/protected/lib"|' "not an AcctMind shell dir"

refuses "the suite's data dir is refused as a shell dir" \
  's|^TEST_SHELL_DIR=.*|TEST_SHELL_DIR="/home/protected/data"|' "not an AcctMind shell dir"

# --- nothing escaped -------------------------------------------------------
if [ -f "$TMP/called.log" ] && grep -qE '^(ssh|rsync|scp) ' "$TMP/called.log"; then
  bad "no broken copy reached ssh/rsync" "$(grep -E '^(ssh|rsync|scp) ' "$TMP/called.log" | head -2)"
else
  ok "no broken copy reached ssh, rsync or scp"
fi

# --- the rules that are text, not control flow -----------------------------
#
# These read the REAL script. A guard expressed as an rsync flag is still a
# guard, and deleting it would be silent.
if grep -qE "rsync[^|]*--delete" "$ROOT/deploy.sh"; then
  bad "no rsync uses --delete"
else
  ok "no rsync uses --delete"
fi

if grep -q "exclude 'index.html'" "$ROOT/deploy.sh"; then
  ok "the asset upload excludes index.html (the DirectoryIndex bypass)"
else
  bad "the asset upload excludes index.html" "nothing excludes it — Apache would serve it ahead of index.php"
fi

if grep -qE 'rsync[^|]*(deploy\.conf|config\.php)' "$ROOT/deploy.sh"; then
  bad "no config is ever uploaded"
else
  ok "no config is ever uploaded"
fi

if grep -qE 'rsync[^|]*/home/protected/data' "$ROOT/deploy.sh"; then
  bad "no data directory is ever written"
else
  ok "no data directory is ever written"
fi

# --- and the real script still refuses without a login ---------------------
if [ -f "$ROOT/deploy.conf" ]; then
  ok "deploy.conf exists (skipping the no-login check)"
else
  out=$(cd "$ROOT" && sh deploy.sh --verify 2>&1 || true)
  if echo "$out" | grep -q "no deploy.conf"; then
    ok "without a deploy.conf the real script stops before doing anything"
  else
    bad "without a deploy.conf the real script stops" "$out"
  fi
fi

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
