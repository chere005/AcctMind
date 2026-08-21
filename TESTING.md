# What the tests cover — and what nobody but a person is watching

The bargain, carried over from CalMind's suite: **change a feature, change
its test in the same commit; add a feature, add a test with it; fix a bug,
add the case that would have caught it.** This file is the map of which
harness watches what. Keep it in step, or something ends up in neither list
and nobody is looking at it.

## Every harness, in one place

| run | what it watches | in the deploy gate? |
|---|---|---|
| `npm run test:dev` | the between-runs suite: three typechecks, core, server, deploy guards — under a minute, no browser | (it IS four of the gates, run early) |
| `npm run test:core` | the behaviour itself, including the `spec/*.json` replay | **yes** |
| `npm run test:server` | the doorway over real HTTP, against the real suite auth lib | **yes** |
| `npm run test:e2e` | the whole app, real mouse, on the EXPORTED bundle, desktop and phone viewports | **yes** (a spot subset on `--quick`) |
| `npm run test:deploy` | every deploy guard, each proven by breaking a copy | **yes** |
| `npm run test:version` | one version across three files AND the generated Info.plist, plus a build number that exists | **yes** |
| `npm run test:peer` | the Bonjour service type and usage string in Info.plist, against core's `PEER_SERVICE` | **yes** |
| `npm run test:watch` | core's real feed through the watch's real Swift decoder and formatter | no — needs `swiftc` |
| `sh desktop/check-assets.sh` | the desktop window opens the path the export was built for | no |
| `./desktop/smoke.sh` | the macOS shell builds, carries THIS export, launches, quits | no — compiles Rust |

The three outside the gate are outside it because each needs a toolchain the
gate cannot assume — `swiftc`, and a Rust compiler. "Outside the gate" is
exactly how a check stops being run, so they are listed here rather than left
to be discovered.

## The layers, and what each one can and cannot prove

**`spec/*.json` + `packages/core`** — the rules, as data. Amounts, days, the
month grid, ordering. This is where a behaviour change starts: edit a vector,
watch it go red, then make it green. The intent is that a native port replays
the same file, which is why the vectors are JSON and not TypeScript.

The suite runs under `TZ=America/Chicago`, deliberately. A UTC slip in a date
is a bug that behaves correctly for anyone testing in the morning; pinning a
western timezone turns it into a failure instead of a coin flip.

**`e2e/`** — the app as a person meets it, driven through the real export at
the real base path. Serving `dist` at `/` instead would pass while the
deployed app was broken, because the whole point of `experiments.baseUrl` is
that assets are requested under `/AcctMind/`.

**`server/tools/test.php`** — the doorway, over real HTTP with real cookies,
against the **real** `seancheren-site` auth library. Not a stub. A mocked
sign-in here would pass whether or not the doorway works, which is the
category of check this project refuses to write. If that repo is not on the
machine the run FAILS and says so; it never skips quietly. Point `SUITE_LIB`
at it if it lives somewhere else.

**`tools/check-deploy-guards.sh`** — every destination guard, proven by
breaking a COPY of `deploy.sh` with `ssh`, `rsync`, `scp` and `curl` neutered
on the PATH first. In CalMind, a run that set out to prove the consent gate
worked — by removing the consent gate — went on to write production. The
neutering is installed before the first copy is ever executed, and one of the
checks is that no broken copy reached `ssh` at all.

**`tools/check-peer-service.mjs`** — `NSBonjourServices` is an ALLOW-LIST, and
that is the entire reason this check exists. A service type missing from it,
or off by one character, does not error: the browser starts, finds nothing,
ever, and there is no failure anywhere to read. This asserts the plist against
core's `PEER_SERVICE`, that nothing stale is listed beside it, that the usage
description exists (without it iOS terminates the app the moment it browses),
and that no Swift file has grown its own copy of the string.

**`tools/check-watch-feed.sh`** — the watch is a separate process in another
language, so `formatAmount` exists twice: once in `packages/core/src/money.ts`
and once in `apps/app/targets/watch/Feed.swift`. This lifts the real Swift out
of the target (never a retyped copy — that tests the typist), compiles it,
feeds it what `watchFeed()` really produces, and compares the drawn strings.
Two copies with a test between them.

## Rules that were in a screen, and are not any more

Three times now a rule sat in a component, and each time the symptom was the
same: the only way to test it was to drive a browser, and the browser could
not do it.

- **The category filter** — substring, case-insensitive, trimmed,
  empty-is-everything. Now `filterByName`, six cases, no browser.
- **The swipe** — when a drag is claimed and when letting go deletes. Now
  `claimsSwipe` and `swipeDeletes`. React-native-web's pan responder does not
  engage under Playwright's mouse, so a 220-pixel drag deleted nothing and
  two gesture tests passed because NOTHING HAPPENED. They were deleted rather
  than kept green.
- **Sorting** — three modes, now `spec/sortmodes.json` and replayed.

What is left for the gesture suite in each case is only that the screen CALLS
the rule, which is what a gesture suite is actually for — and on 2026-08-21
that turned out to be worth its own check: `sort-date` and `sort-amount` were
asserted NOWHERE, so the middle chip could have passed `custom` with core
perfect and the suite green. `rowactions.spec.ts` now drives all three
against a fixture where no two modes agree.

## A harness quirk worth knowing before you debug the app

Under the **mobile** project, `fill()` on a `Modal`'s `TextInput` can silently
do nothing: the value reads back empty, React having re-rendered the
controlled input from state that never changed. The only symptom is Save
appearing to do nothing while the form says "Name is required" — the app is
fine. CLICK the field first, then fill. Chromium does not need it, so a test
written and checked there will fail on mobile for a reason that has nothing to
do with the code under test. `sections.spec.ts` carries the note at the one
place it bit.

## The v4 migration, and why it is unit-tested rather than spec'd

Store v4 moved the money off the category and onto a line underneath it, and
re-filed every transaction from the category to that line. Seven cases in
`store.test.ts` cover it, including the two that matter most: the line's id is
DERIVED from the category's, so a phone and a Mac upgrading the same ledger
independently land on the same record instead of two lines holding the same
money; and the line keeps the category's merge clock, so neither device wins a
merge it has no new information for. All five plausible ways to get it wrong
were tried and all five went red.

There is still no `spec/` vector for any migration — that remains the gap it
was, and it matters more now that there are two of them.

## What the harness cannot drive at all

React-native-web's `PanResponder` does not engage under Playwright's synthetic
mouse. Anything that is only a finger is therefore invisible here, and the
honest response is to move the DECISION into core and check the wiring by eye:

- **Swipe to delete** — `claimsSwipe` / `swipeDeletes` in core. Two browser
  tests were deleted for passing while nothing happened.
- **Drag to reorder** (the grip, 2026-08-21) — `reorder` and `orderBetween` in
  core; `rowdrag.ts` turns a finger into a destination index and nothing else.
  What the suite still checks is whether the handle is OFFERED, per sort mode,
  and that hiding it does not move the row's contents. The drag itself was
  checked on a simulator, by hand.

## Two tests that flake under full parallel load

Both read GEOMETRY or COMPUTED STYLE right after an interaction, and both have
failed once each in a full parallel run and passed on every rerun and in
isolation: `rowactions.spec.ts` "the action cluster … leaves the name alone"
and `persist.spec.ts` "a store written by an older run loads". The reading
appears to race a layout pass when four workers are contending.

They are recorded rather than quietly rerun until green. If either starts
failing more than occasionally, the fix is to wait on the thing being measured
rather than to raise a timeout — a geometry assertion that needs a sleep is an
assertion about the wrong moment.

## A check that was watched failing at nothing

Worth keeping as a worked example, because it looked like a good test.

"Opening a row moves nothing" was written by measuring every row's rect before
and after the long press and asserting they matched. It passed. Then the bug
it was written for — buttons with `minHeight: 44` inside a row laid out at 36
— was put BACK, and it still passed: an absolutely positioned child that
overflows does not change its container's rect, so the measurement could not
see the thing it was measuring for.

It now asserts CONTAINMENT — each control's box against its row's box — which
is the property that actually differs.

The companion trap, from the same afternoon: **a flex child's box is not its
text.** `txn-name` carries `flex: 1`, so its bounding box is the whole left
half of the row however short the word inside it is. An assertion that the
action cluster "starts to the right of the name" therefore fails on a working
app and would pass on a broken one at a different width. Measure against the
ROW. Two honest notes on it: real rows come
out around 53 points tall (two stacked lines plus padding), so 44-point
buttons genuinely fit and the restored bug does not trip it either. The check
is a true invariant that would catch a control drawn larger than its row; it
is NOT evidence that the reported shifting is fixed. That was checked by eye
on a simulator.

## Checks that had to be about a computed style

Two things in this app differ between working and broken ONLY in CSS that no
visibility assertion reads. Both are in `rowactions.spec.ts` and
`sections.spec.ts`:

- **A transaction row paints its own background.** The swipe's red delete
  backdrop sits behind every row and is correctly visible at all times; with a
  transparent row on top, the whole ledger drew red. `toBeVisible()` is true
  on both layers in the broken app and in the fixed one — see AGENTS.md.
- **A colour picked in Manage rides on the RECORD.** Twelve swatch controls
  were asserted by nothing. The assertion is on the STORE, not on the dot:
  a colour that lived only on the device that picked it would make one ledger
  look like two.

## What nobody is watching

- **The Mac app, at all.** It compiles for `platform=macOS,variant=Designed
  for iPad` and has never been LAUNCHED — not once, by anyone. A shell cannot
  do it (see README), so it takes Xcode and a person. Everything said about
  phone-to-Mac sync is therefore reasoning, not observation: the two
  simulators proved the transport, and the Mac has never been one of the two
  ends.

- **That the desktop window actually RENDERS.** A window showing an error page
  launches, survives eight seconds and quits exactly like a working one. The
  smoke guards the specific failure that caused it in CalMind — the window
  opening a path the embedded assets do not have — by reading the asset paths
  out of the built binary. It does not watch pixels. Proving that needs
  screen-recording permission or a probe build.
- **Anything that only breaks on a finger.** Three bugs shipped through a
  green gesture suite on 2026-08-21: a tab bar restyled as a bottom bar but
  left first in the JSX; a swipe handler that claimed the gesture at six
  pixels and so cancelled every long press — a held finger drifts further
  than that, a mouse does not; and a transparent row that let the delete
  backdrop show through, which no visibility check could see. The first two
  were invisible because a phone VIEWPORT is not a phone; the third because
  the suite was asking the wrong question. All three now have a check, and
  all three were watched failing. This is the same trap `hitSlop` set, in
  three new costumes.

- **The phone and the watch, on real hardware.** The web harness runs a phone
  VIEWPORT, which is not a phone: a browser has no status bar to hide under,
  and `hitSlop` is a no-op under react-native-web while it works on native.
  Open the simulator and look — the iOS app and both modals were checked that
  way on 2026-08-20, on an iPhone 17 Pro simulator, and the add form does
  clear the status bar.

  When you do, build **Release** (`npx expo run:ios --configuration Release`).
  A dev build asks a Metro server for its bundle and does not check which
  project answered — with CalMind's bundler on the default port, AcctMind's
  app loaded CalMind's bundle and died on a native module it does not have.
  Release embeds the bundle, so there is nothing to get wrong. See
  `apps/app/AGENTS.md`.
- **Two devices actually finding each other**, as an automated check. It was
  done BY HAND on 2026-08-20, with two booted simulators, and it earned its
  keep immediately: the browser was dropping every peer because
  `includeTXTRecord` defaults to false. Nothing in the repo replays that.

  The technique, since it is not obvious: boot a second simulator, `simctl
  install` the same `.app` on both, pair them through the UI, and — this is
  the part that found the bug — run `dns-sd -B _acctmind1._tcp` on the Mac.
  The host sees what the simulators advertise, so a service that is visible
  there and invisible to the other app localises the fault to the BROWSER
  rather than the advertisement.

- **The TLS-PSK handshake, as an automated check.** It was measured by hand
  on 2026-08-20 with a standalone Swift probe (one listener, one client, same
  secret, loopback, six option variants), and that probe found the app's TLS
  options were unusable: pinning to TLS 1.3 fails with
  `NO_SUPPORTED_VERSIONS_ENABLED`, because Apple's PSK support is TLS 1.2.
  Nothing replays it.

  What the link negotiates, measured: TLS 1.2, ciphersuite 0x00A8
  (`TLS_PSK_WITH_AES_128_GCM_SHA256`). **No forward secrecy** — see the note
  in `PeerLink.swift` for what that does and does not cost. Appending any
  other ciphersuite, including the ECDHE-PSK and DHE-PSK ones, changes
  nothing; that was measured too.

  A handshake that fails at runtime is silent from inside the app: the
  browser finds the service and the connection simply never reaches `.ready`.
  `peers` on the Devices screen is the only tell in the UI; the device log
  under `com.apple.network:boringssl` is the only real diagnosis.

- **The watch's transport, on hardware.** The feed shape is proven and the
  decoder is proven, and `WatchBridgeModule` now compiles — it did not for a
  whole commit, because nothing had triggered a full iOS build since it was
  added. Compiling is not delivering: nobody has watched a feed reach a real
  wrist.
- **iOS and Android builds, on a schedule.** `ios/` and `android/` are
  `expo prebuild` output and disposable; nothing rebuilds them automatically.
  Both have been built and run by hand (2026-08-20).

- **The Windows bundle.** The workflow exists and has never run. It needed a
  GitHub remote, which no longer blocks it — `origin` is chere005/AcctHub as
  of 2026-08-20 — so this is now just undone rather than impossible.

## Before you trust a new check

Break the thing it guards and watch it go red. Every check in this repo has
been watched failing on purpose:

- the spec replay, against a parser that rounds three decimals, a `today()`
  written as `toISOString().slice(0,10)`, and a sort with its id tiebreak
  removed;
- the platform-neutrality typecheck, against an `import 'node:fs'` in core;
- the freshness gate, against a source edit the dist had not seen;
- all fourteen deploy guards, against copies with their constants rewritten,
  plus the two text rules (`--delete`, the `index.html` exclusion) removed
  from the real script;
- the watch checker, against a Swift formatter with its digit grouping taken
  out;
- the pairing tests, against five mutations of `peer.ts` — a plain sum for
  Luhn, no checksum at all, the O/I/L folding removed, a 40-bit secret, and a
  confusable character put back in the alphabet. The first of those is why
  the transposition test now derives its own fixture: with a literal code it
  stayed GREEN under an order-blind checksum, which is the exact shape of a
  check that cannot fail;
- `check-peer-service.mjs`, against a one-character drift in the plist, a
  removed usage description, a stale extra service left in the list, and a
  hardcoded service type in Swift;
- the peer module's Swift, against a deliberate type error — to prove
  `xcodebuild -scheme PeerSync` was compiling the file at all and not
  reporting a cached success.

A check nobody has seen fail is a check nobody should trust. Five green
checks in CalMind turned out to be worthless in a single session.
