# Working on AcctMind

Sean's ledger. `README.md` is the map, `TESTING.md` is what the tests are
worth. This file is how to work in here.

Two lists below. The second is **inherited** — traps that cost real time in
CalMind (`~/GIT/CalMind`), whose architecture this is, written down before
they could be rediscovered. The first is what has cost time *here*. Anything
learned goes in the commit that learns it.

## Standing rules

- **Behavior lives in `packages/core`.** A screen holds plumbing. If you can
  describe a rule in a sentence — how an amount is parsed, how the list is
  ordered, what a valid transaction is — it belongs in core, with a test.
  Six surfaces means a rule written in a screen is a rule written wrong five
  more times. `packages/core/tsconfig.json` sets `"types": []`, so core
  cannot reach a Node, DOM or React Native API without the typecheck failing:
  the neutrality is checked, not trusted.

- **Money is integers.** Amounts are stored and computed in minor units
  (cents), formatted only at the edge. Floats are for physics. A cent lost to
  a rounding step is the one bug this product cannot have — which is also why
  `parseAmount` REFUSES `1.005` rather than picking a rounding.

- **The device is the only copy.** There is no server ledger to recover from.
  A store that will not parse is never an empty store: `parseStore` returns
  an error, the app renders it, and nothing writes until a person chooses to
  discard. Before adding any code path that saves, ask what it does on top of
  a failed load.

- **`spec/` is the contract.** Changing what AcctMind does starts by changing
  a vector, watching it go red, then making it green. A behaviour change that
  touches no spec file is either not a behaviour change, or is not covered.

- **Break it before you trust it.** Every check in here has been watched
  failing on purpose, and `TESTING.md` lists how. Five green checks in
  CalMind turned out to be worthless in a single session. A check that cannot
  fail looks exactly like one that passes.

- **CalMind is the reference, not the source.** Grep it before inventing an
  approach — the Expo/Tauri/PHP seams are solved there. But nothing is copied
  without being read, and nothing is IMPORTED from it: another agent works in
  that repo, and AcctMind must never depend on its state.

- **Nothing here may write CalMind's areas.** `/AcctMind` and
  `/test/AcctMind` are this app's; nowhere else is. Destinations are guarded
  constants, never variables, and the guards get proven by breaking copies of
  the real script — never the real script.

- **Deploy to both, for now.** `./deploy.sh` writes the sandbox and then
  production. Sean's call, 2026-08-20, and it holds until he says to switch
  to test-only — at which point the change is one line and the guards already
  cover it.

- **`main` is the branch.** Stage explicit paths — never `git add -A`. Sean
  makes his own commits unless he says otherwise.

## Versions and builds

Two numbers answering two questions, and conflating them cost an evening.

- **`version`** — which RELEASE this is. Semver, and it lives in three files
  that `tools/check-version.mjs` holds together: the root `package.json`,
  `apps/app/package.json`, and `app.config.js`. Tags match it. Patch tags are
  fine; CalMind has 0.8.1 and 0.13.2.

- **`ios.buildNumber`** — which BUILD of that release is on the device.
  HAND-bumped every time a build leaves this machine, not once per release.
  CalMind's README says why and this repo proved it: with no build number
  every install reads `1`, and "is the thing I just installed actually on the
  device?" has no evidence either way. Four builds went onto a phone in one
  evening, all reporting `0.4.0/1`, and telling them apart meant hunting for
  features.

**`app.config.js` is SOURCE; `apps/app/ios/` is prebuild output.** Bumping the
config and building without `expo prebuild` installs a binary carrying the old
number — the check goes green while the phone disagrees, because three source
files agreeing with each other says nothing about the plist that ships.

WHERE THAT IS CHECKED, since 2026-08-22: `npm run test:version:device`, run by
CoreMind's `bin/build-platforms.sh` immediately after prebuild — the one moment
the plist is both fresh and about to be installed. `npm test` runs
`test:version` (`--sources-only`), which holds the seven source files together
and says out loud that it skipped the plist.

The split exists because the old arrangement blocked releases. The plist goes
stale the instant a version bumps and stays stale until something prebuilds, so
"stale" is the ORDINARY state between a release and the next device build — and
`npm test` treating it as an error meant every release blocked the next one.
0.14.0 died exactly there: version 0.13.0, plist 0.11.0, nothing shipped, the
gate naming a real disagreement that no web deploy could ever have caused.

## Shorthand

- **`dtp` = deploy, tag, push; `tdtp` = TEST, deploy, tag, push.** Two lanes
  since Sean's 2026-08-22 word, one gesture each: `npm run dtp` /
  `npm run tdtp` (tools/dtp.sh, tools/tdtp.sh). The `t` in front is the full
  test run, not the tag — the tag is mid-lane and has no letter of its own.
  (This entry has been rewritten twice: first written down wrong as
  test-deploy-tag-push under one name, then split into the two lanes. Which
  is exactly the kind of thing this file exists to stop costing a third
  round of asking.)

  1. **Test** — tdtp only: `npm test`, the whole of it, before anything is
     touched.
  2. **Deploy** — `./deploy.sh --quick` for dtp, `./deploy.sh` (full) for
     tdtp. Both write the sandbox and then production and run their own
     gates on the way — the quick lane's gates are everything that costs
     seconds plus the spot test, so a dtp is never an unverified deploy.
  3. **Tag** — an annotated BARE tag at the new version (AcctMind's tags
     carry no v).
  4. **Push** — `git push --follow-tags`, then the desktop-windows dispatch.

  A failed deploy stops the lane: nothing is tagged, nothing is pushed, and
  a re-run reuses the still-untagged version rather than burning a number.
  The deploy's own gates include `npm run test:server`, so either lane is
  blocked whenever the server suite is red, and it should stay blocked: the
  gate failing is the gate working.

  **A `dtp` bumps the MINOR version — and so does a `tdtp`.** Sean,
  2026-08-21. Not a judgement call
  each time about whether something was "big enough" — 0.9.2 goes to 0.10.0,
  and so does the one after it. The build number restarts at 1 with it.

  The reason to take the choice away: a `dtp` is what puts a build on his
  phone, so every one of them is a thing he will later want to name. Deciding
  patch-or-minor per release means the numbers encode my opinion of the work
  rather than counting the times it shipped, and this session alone produced
  0.8.1, 0.9.1 and 0.9.2 by that opinion. Counting is more useful than
  grading.

  Verify the bump rather than assuming it: a `sed` that matches nothing
  reports success. `tools/check-version.mjs` compares all seven files AND the
  generated `Info.plist`, including the build number — the field whose whole
  job is telling two builds apart, and which nothing checked until it slipped
  through once.

## Platforms

Five surfaces, shipped by two different pipelines.

- **Web** — this app's own server. Production at `seancheren.com/AcctMind`,
  a separate test deploy at `test.seancheren.com/AcctMind`. `./deploy.sh`
  writes both, sandbox first — see "Deploy to both, for now" above. This is
  the platform `dtp`/`tdtp` (above) actually ship.
- **Windows** — built and smoke-tested on a Windows GitHub Actions runner,
  `.github/workflows/desktop-windows.yml`, dispatched by `dtp`/`tdtp`'s push
  step (above). Tauri can't cross-compile it — see "tauri.conf.json" below.
- **macOS** — the Tauri desktop bundle in `desktop/`. Not built by this
  repo's own deploy; built by CoreMind's shared `bin/build-platforms.sh
  --mac` (smoke-tested locally with `desktop/smoke.sh`). No `dmg` — see
  "tauri.conf.json" below. `build-platforms.sh` copies the bundle into
  `/Applications` and verifies the copy — that step was missing until
  2026-08-22, so every app's macOS build had succeeded and none of them was
  installed. (`apps/app/ios` can separately be built as "My Mac (Designed for
  iPad)". That is NOT the same thing as MyCalMind's Mac Catalyst app, which
  CoreMind's script now builds and installs properly; this one is still Xcode
  GUI only and part of no deploy.)
- **iOS** — installs to the physical phone, one of its 3 free-tier device
  slots, via CoreMind's `bin/build-platforms.sh --ios` (confirmed
  2026-08-22).
- **Android** — builds, installs and launches on a local emulator via
  CoreMind's `bin/build-platforms.sh --android` (confirmed 2026-08-22).
- **No watchOS target** — see "The watch is out, for now" below.

`sh bin/dtp.sh all --full --platforms`, run from CoreMind, drives the whole
suite's `tdtp` lane and builds whatever each app's own deploy does not ship
by itself — for AcctMind, that's macOS, iOS and Android.

## tauri.conf.json takes no notes, so its notes live here

- **NO `dmg` in `bundle.targets`.** create-dmg's `bundle_dmg.sh` needs Finder
  and AppleScript and dies on this machine, so `tauri build` failed AFTER
  bundling a perfectly good `AcctMind.app` — the release had already shipped
  and the desktop step reported a failure whose first 12 lines are all
  successes. CalMind and ChefMind have excluded it for exactly this reason and
  the note only ever got written down in ChefMind's rules, which is why this
  one had to be rediscovered by watching it fail (2026-08-22).
- **`msi`/`nsis` are config-only here.** Tauri does not cross-compile;
  Windows builds on a windows runner — `.github/workflows/desktop-windows.yml`,
  dispatched after a dtp's push.
- **The file takes NO extra keys.** A `"_note"` beside the real ones fails the
  schema outright: `Additional properties are not allowed`. Hence this section.

## The watch is out, for now

Sean, 2026-08-21: drop the watch component entirely for now. So
`apps/app/targets/watch/`, `apps/app/modules/watch-bridge`,
`packages/core/src/watch.ts`, `apps/app/src/watch.ts` and
`tools/check-watch-feed.sh` are gone, along with the `test:watch` script, the
`@bacons/apple-targets` plugin and its dependency.

FOR NOW is the operative phrase and the reason nothing below was deleted with
it. The watch traps in this file stay: every one of them cost time, none of
them is about code that still exists, and all of them will be true again the
day the target comes back. Restoring is one `git revert` of the commit that
removed it, plus the plugin line in `app.config.js`.

## Traps that have cost real time HERE

- **A `Pressable` inside a row answers the tap BEFORE the row does, so a
  mode the row is in has to be pushed down into every child.** The swipe
  parks a delete, and a tap on the row put it away — except the name, the
  amount and the date each sit in their own `Pressable`, on top, each with an
  `onPress` that had never heard of the parked delete. Those three cover
  nearly the whole row, so the only ways out of an armed delete were to use it
  or to hit the few pixels of background between two fields. Sean found it on
  the phone: "tap to exit the swipe delete."

  The fix is not four handlers agreeing. It is ONE rule — core's `rowTap` —
  read once per row, with the precedence stated in it, and every part of the
  row deferring to that. Four `onPress` expressions is four chances to get an
  ordering wrong, and two of them had.

- **`PanResponder` ignores Playwright's synthetic MOUSE and obeys a real
  TOUCH stream, and this repo wrote off the swipe over the difference.**
  Three attempts drove it with `page.mouse`, nothing engaged, a 220-pixel drag
  deleted nothing — so the tests passed while doing nothing, two were deleted,
  and `TESTING.md` gained a section headed "what the harness cannot drive at
  all". That section was wrong from the day it was written.

  `Input.dispatchTouchEvent` over CDP drives it — `swipeRow` in
  `e2e/helpers.ts`. Chromium only, since the mobile project is WebKit and has
  no CDP session. **A gesture that cannot be driven one way has not been shown
  undrivable**; and any such claim in here is worth re-testing rather than
  inheriting, because the cost of believing it is a whole feature with no
  coverage.

- **Backticks inside `git commit -m "…"` are command substitution.** A message
  reading ``runs the same `submit` the button does`` was committed and pushed
  as "runs the same  the button does" — the shell ran `submit`, found nothing,
  and dropped the word. Nothing failed; the commit succeeded with a hole in
  it. Every message worth writing goes through a heredoc to a file and
  `git commit -F`, which is what the long ones already do.


- **A side effect inside a `setState` updater silently discards the other
  updates batched with it.** `setPhase(p => { save(...); return next; })`
  looks harmless. React treats a state update raised during an updater as a
  render-phase update and RESTARTS the render — so the `setAdding(false)`
  queued alongside it was thrown away, the transaction saved perfectly, and
  the add form stayed open. Updaters are pure. Compute from current state in
  the handler and call the effect there. Pinned by `e2e/add.spec.ts`.

- **`npx expo run:ios` for a SIMULATOR never exits, and the processes it
  leaves behind will eventually RACE each other.** It builds, installs,
  launches — and then stays attached streaming the app's own log, so a script
  ending in `echo "STATUS=$?"` never writes that line and a monitor waits out
  its whole timeout while the app has been running for twenty minutes. The
  giveaway in the log is RUNTIME chatter (`RCTScrollViewComponentView`,
  `SyncedDefaults`) where build output should be.

  The second half is worse. Every run leaves the process alive, and three of
  them accumulated before two `xcodebuild`s collided:

      unable to attach DB ... database is locked. Possibly there are two
      concurrent builds running in the same filesystem location.

  What that cost was not the failed build — it was half an hour spent
  diagnosing a layout bug from a SCREENSHOT OF THE WRONG BINARY. With builds
  racing, which app got installed is a coin toss, and the screen is then
  evidence about code that is not the code in front of you. The placement
  being debugged turned out to be correct; on-screen instrumentation printing
  the measured numbers is what proved it.

  **Do not use `expo run:ios` for the simulator.** `tools`' sim script does
  what the device path does — `xcodebuild -destination "platform=iOS
  Simulator,id=<udid>"`, then `simctl install`, then `simctl launch` — which
  ends, reports a status per step, and kills leftovers before touching the
  build database. And when a screenshot disagrees with the code, check that
  the build actually installed before believing either.

- **`npx expo run:ios --device` HANGS on a locked phone, after a successful
  build.** The build finishes, the install starts, and then it sits on
  `Connecting to: iPhoooooone` for ever because the launch step cannot reach a
  locked device. A background task waiting on that looks exactly like a build
  still compiling. Build and install as two steps — `xcodebuild … build`, then
  `xcrun devicectl device install app` — and `devicectl` will install onto a
  locked phone quite happily; it is only the LAUNCH that needs it awake.

- **CocoaPods dies with `Encoding::CompatibilityError` unless `LANG` is
  UTF-8.** `Unicode Normalization not appropriate for ASCII-8BIT`, thrown from
  `Pod::Config#installation_root`, with a stack trace and no mention of the
  locale except one `export LANG=en_US.UTF-8` buried in its own advice. Every
  script here that runs `pod install` exports it.

- **A build script that ends in `echo` reports success no matter what
  happened.** A backgrounded `xcodebuild` was reported as exit code 0 while
  its log said `'ios/AcctMind.xcworkspace' does not exist` — a relative path
  resolved from the wrong directory (the persisting-`cd` trap, again), and the
  script's own last statement was the thing being asked for a status. Capture
  the status of the command you care about into the log — `echo
  "BUILD_STATUS=$?"` — and grep for THAT, never the task's exit code.

- **A backdrop revealed by a gesture needs the thing in front of it to be
  OPAQUE, and no visibility check can tell you it is not.** The swipe-to-
  delete layer is absolutely positioned behind every row. The row had no
  background, so the red showed through at rest: the whole ledger drew solid
  red with `Delete` printed across each amount. Sean found it on the phone
  and described it as "transactions don't show up well under a section" — a
  sentence that sounds like spacing.

  What makes it worth writing down is why 147 green checks said nothing. The
  backdrop is CORRECTLY present and CORRECTLY visible in both the broken app
  and the fixed one; so is the row. `toBeVisible()` and `toBeHidden()` cannot
  separate the two states, and neither can a screenshot diff nobody takes.
  The only difference is whether the row PAINTS, so that is what
  `rowactions.spec.ts` reads — `getComputedStyle(...).backgroundColor` is not
  `rgba(0, 0, 0, 0)`. **When two states differ only in a computed style, the
  assertion has to be about that style.**

- **`react-native-web` leaves a hidden `Modal` in the DOM.** So
  `querySelector('[data-testid="save-button"]')` finds the add form long
  after it has closed, and a presence check reports "still open" forever —
  passing with the bug present and with it absent. That check cost a round of
  debugging a bug that was already fixed. Assert on VISIBILITY:
  Playwright's `toBeVisible()` / `toBeHidden()` read computed style.

- **`set -e` is inherited by a command substitution's subshell.** So
  `status=$(cmd; echo $?)` never reaches the `echo` when `cmd` fails: the
  subshell dies first, the variable comes back empty, and the script exits
  silently. `if cmd; then … else … fi` is the construct that suspends
  errexit. This ate `tools/check-deploy-guards.sh` and made it print its
  header and stop.

- **Base-36 timestamps only sort lexicographically at a fixed width.**
  `newId(1000)` is `'rs'` and `newId(2000)` is `'1jk'`, so the later id sorts
  first. Every real timestamp is 8 characters today, so this would have
  looked correct for another thirty years and then quietly stopped. The
  prefix is padded; do not unpad it.

- **`render_login()` requires the CALLER to have defined `e()`.** It is an
  implicit contract of the suite — every app in seancheren-site defines its
  own copy at the top of its page. Without it the login screen dies halfway
  through its own `<head>` with "Call to undefined function e()", which
  renders as a broken page rather than an error because the status line has
  already gone out. `server/public/index.php` defines it, guarded.

- **An `index.html` in the web root walks straight around the sign-in.**
  Apache's stock `DirectoryIndex` lists it before `index.php`. So the deploy
  excludes it, the app shell lives OUTSIDE the web root entirely, the
  `.htaccess` pins `DirectoryIndex index.php`, and the deploy checks the
  server afterwards. Three locks, because the failure is silent and total.

- **One export cannot serve both paths.** A bundle built for `/AcctMind` and
  served under `/test/` requests the other instance's chunks — the sandbox
  silently running production's code. `deploy.sh` exports once per instance
  and refuses an export whose stamp names the wrong base.

  Measured rather than assumed, 2026-08-20: today the two exports are a
  byte-identical bundle differing only in `index.html`, because this app has
  no lazy imports and so no async chunks for the path to land in. CalMind's
  version of this note says the path is in the JS — true there, not yet true
  here. It becomes true the moment anyone writes an `import()`, and
  `index.html` differs regardless, so the per-instance export stays.

- **Both of the bugs below were already solved correctly in CalMind, and
  grepping it first would have cost two minutes.** The standing rule says
  "CalMind is the reference — grep it before inventing an approach", and it
  was not followed. `CalMind-local/app/modules/watch-bridge` already had the
  delegate as its own `NSObject`, and `CalMind-local/packages/core/src/sync.ts`
  already stamped every write — deletes included — through
  `Math.max(now, prev.updated + 1)`. AcctMind shipped a watch bridge that
  could not compile and a `tombstone` that could lose a delete on merge.
  Reading first is cheaper than mutation-testing your way back to the same
  answer.

- **An Expo `Module` is not an `NSObject`, so it cannot be a delegate.**
  `WatchBridgeModule: Module, WCSessionDelegate` looks obvious and does not
  compile — `WCSessionDelegate` inherits `NSObjectProtocol` and Swift refuses
  the conformance. What made it expensive is WHERE the error surfaced: the
  watch bridge sat in the tree for a whole commit without ever being built,
  because nothing had triggered a full iOS compile since it was added, and it
  finally failed inside an unrelated feature's build. Give the delegate its
  own `NSObject` subclass and hold it (WCSession keeps its delegate weakly).

  **Swift that nothing has compiled is not written yet.** This file sat in
  the tree for a whole commit looking finished. Compile a pod alone with
  `xcodebuild -scheme <PodName>` — seconds against a full build's minutes.

- **`NWBrowser` omits the TXT record unless you ask, and the default costs
  you the whole feature.** The descriptor you want is
  `.bonjourWithTXTRecord(type:domain:)`; with plain `.bonjour(type:domain:)`
  `result.metadata` is never `.bonjour(...)`. The peer filter
  read it to tell this device from another, found nothing, and skipped every
  result with a `continue`. What that looks like: both devices advertise,
  both browsers report `ready`, `dns-sd -B _acctmind1._tcp` on a Mac lists
  both instances — and the two apps never see each other, with no error
  anywhere in the log. Found only by browsing from the host and asking why
  something visible from outside was invisible from inside.

  The general shape, worth remembering beyond this API: **when a filter's
  input is missing, `continue` is indistinguishable from "no match".** If a
  guard skipping an item would mean the feature silently does nothing, it
  needs to be loud.

- **`-destination 'generic/platform=iOS Simulator'` builds the WATCH target
  against the iOS SDK, and everything it then reports is a lie.** Reaching
  for the generic destination to be thorough produced two convincing errors
  in `targets/watch/`: `WatchSession` "does not conform to WCSessionDelegate"
  (demanding `sessionDidBecomeInactive`/`sessionDidDeactivate`, which are the
  PHONE's half and are not required on watchOS), and an `AppIcon` that "did
  not have any applicable content" (the icon is a valid opaque 1024×1024
  PNG). Both files were correct. Half an hour went into fixing code that had
  nothing wrong with it, and a wrong explanation was nearly committed with
  the fix.

  Build the app the way Expo does — `-destination 'platform=iOS
  Simulator,id=<udid>'`, a SPECIFIC device — and build the watch on its own
  platform: `-scheme AcctMindWatch -destination 'platform=watchOS
  Simulator,id=<udid>'`. If a target's errors look absurd, check which SDK it
  is being compiled against before believing them.

- **A test that mutates a hard-coded value tests nothing once the algorithm
  changes.** `peer.test.ts` proved the pairing checksum caught every adjacent
  transposition by mutating a literal code. Replace Luhn with a plain sum —
  which genuinely does NOT catch transpositions — and the test stayed green,
  because the literal no longer parsed under the new algorithm, so every
  mutation of it was refused for the wrong reason. DERIVE the fixture from
  the code under test, and assert the underived fixture is valid first. That
  guard line is the whole difference between the two versions.

- **A frame counter is not a rate limit.** The peer link first capped each
  connection at eight frames, to stop a runaway exchange. Eight is also what
  a person adding eight transactions sends, so the cap would have made sync
  stop working and look exactly like sync being broken. What needs bounding
  is arrival RATE, not lifetime count: a token bucket costs the same ten
  lines and does not punish real use.

- **Core's imports are extensionless, and two toolchains disagree about
  that.** Metro cannot resolve `./money.js` in TypeScript source; Node's ESM
  cannot resolve `./money`. Core is written extensionless for Metro, and
  `tools/register-ts.mjs` is what lets a Node script import it.

## Traps, inherited from CalMind

- **The shell's working directory persists between Bash calls.** A `cd` into
  a subdirectory silently breaks the next command's relative paths. Use
  absolute paths.

- **A `click()` on a control that has gone does not fail fast.** It waits out
  the whole test budget and reads as a hang. Hence `actionTimeout` in the
  Playwright config, and a short explicit timeout on anything speculative.

- **`hitSlop` is a no-op under react-native-web.** A control is exactly as
  big as it is drawn on the web and bigger on native — the two disagree
  silently, in the direction that hurts Safari on a phone. Controls here are
  DRAWN at `TAP` (44pt); do not shrink one and add `hitSlop`.

- **A React Native `Modal` is its own window, outside the safe area.**
  Anything positioned in one sits under the clock on a phone, and it is
  invisible in every browser test because a browser has no status bar to hide
  under. Both modals here re-apply `useSafeAreaInsets` for that reason.

- **Comments state intent; the code may have drifted.** Two real CalMind bugs
  came from reading one against the other.

- **`dist` holds more than one `index-*.js`.** Read the entry name out of
  `dist/index.html` rather than `find | head -1`.

- **Ask what happens when a write fails.** The worst bugs CalMind found were
  all silent. Search for `.catch(() => {})` and triage each by what is lost.

## The bargain on tests

Change a feature, change its test in the same commit. Add a feature, add a
test with it. Fix a bug, add the case that would have caught it.

The quick lane exists so a small fix is cheap to ship. It stays honest by
keeping every gate that costs seconds and swapping only the ones that cost
minutes for a spot check. A quick deploy that skips a gate to be quick is
just a deploy with a gate missing.
