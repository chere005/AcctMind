#!/bin/sh
# Core's REAL feed, through the watch's REAL decoder and drawing code.
#
# The watch is a separate process in another language, so `formatAmount` is
# written twice — once in packages/core/src/money.ts and once in
# apps/app/targets/watch/Feed.swift. Two copies of one rule drift. This is
# what stops them: it lifts the actual Swift out of the target (never a
# retyped copy — a retyped copy tests the typist), compiles it, feeds it the
# JSON `watchFeed()` really produces, and compares the drawn strings
# character for character against the ones core says it should have drawn.
#
# Needs `swiftc`. It is outside the deploy gate for that reason, and is why
# TESTING.md lists it among the ones that have to be REMEMBERED.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if ! command -v swiftc > /dev/null 2>&1; then
  echo "check-watch-feed: no swiftc on this machine — cannot check the Swift twin." >&2
  echo "  (Refusing to pass instead: a skipped check that reports success is worse than none.)" >&2
  exit 1
fi

TMP="${TMPDIR:-/tmp}/acctmind-watch-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# The real file, lifted verbatim.
cp "$ROOT/apps/app/targets/watch/Feed.swift" "$TMP/Feed.swift"

cat > "$TMP/main.swift" <<'SWIFT'
// Reads a feed on stdin, prints one drawn row per line, then the title.
// Uses the target's own decoder and its own formatter — nothing is
// re-implemented here.
import Foundation
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let feed = WatchFeed.decode(data) else {
    FileHandle.standardError.write("the watch could not decode that feed\n".data(using: .utf8)!)
    exit(2)
}
for row in drawnRows(feed) { print(row) }
print("TITLE " + formatAmount(feed.t))
SWIFT

swiftc -O -o "$TMP/watchcheck" "$TMP/Feed.swift" "$TMP/main.swift" 2>&1 | grep -v '^$' || true
[ -x "$TMP/watchcheck" ] || { echo "check-watch-feed: the target's Swift did not compile" >&2; exit 1; }

# Core builds the feed and says what it should draw. The cases deliberately
# include the ones that separate a hand-rolled formatter from a careless one:
# grouping boundaries, a lone cent, a negative, and more rows than the limit.
node --import ./tools/register-ts.mjs -e "
import { watchFeed, drawnRows } from './packages/core/src/watch.ts';
const t = (id, name, amount, date) => ({ id, name, description: '', amount, date, created: Number(id) });
const txns = [
  t('1', 'Coffee',    -450,        '2026-08-20'),
  t('2', 'Paycheck',   240000,     '2026-08-19'),
  t('3', 'Penny',      1,          '2026-08-18'),
  t('4', 'Big',        123456700,  '2026-08-17'),
  t('5', 'Round',      100000,     '2026-08-16'),
  t('6', 'Owed',      -123456,     '2026-08-15'),
  t('7', 'Zero',       0,          '2026-08-14'),
];
const feed = watchFeed(txns);
process.stdout.write(JSON.stringify({ feed, drawn: drawnRows(feed) }));
" > "$TMP/core.json"

node -e "process.stdout.write(JSON.stringify(require('$TMP/core.json').feed))" > "$TMP/feed.json"
"$TMP/watchcheck" < "$TMP/feed.json" > "$TMP/swift.txt"

node -e "
const fs = require('fs');
const { feed, drawn } = require('$TMP/core.json');
const lines = fs.readFileSync('$TMP/swift.txt', 'utf8').trimEnd().split('\n');
const title = lines.pop();
let fail = 0;
const eq = (what, a, b) => {
  if (a === b) { console.log('  ok   ' + what); }
  else { console.log('  FAIL ' + what + '\n       core: ' + a + '\n       swift: ' + b); fail++; }
};
eq('the wrist draws the same number of rows', String(drawn.length), String(lines.length));
drawn.forEach((want, i) => eq('row ' + (i + 1) + ' reads the same on both', want, lines[i]));
// The title is the total of EVERYTHING, not of the rows that were sent.
const ct = drawnTotal(feed.t);
eq('the title is the same total', 'TITLE ' + ct, title);
function drawnTotal(c) {
  const n = c < 0, a = Math.abs(c);
  const g = String(Math.trunc(a/100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n?'-\$':'\$') + g + '.' + String(a%100).padStart(2,'0');
}
console.log('');
console.log(fail === 0 ? 'the Swift twin agrees with core' : fail + ' disagreement(s)');
process.exit(fail === 0 ? 0 : 1);
"
