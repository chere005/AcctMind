# Working on AcctMind

The baseline for all of Sean's repos lives in ~/GIT/AgentSuite/AGENTS.md
and is imported here; this file holds only what is true of THIS repo.
@../AgentSuite/AGENTS.md

Sean's ledger, CalMind's architecture (`~/GIT/CalMind`). See README.md, ARCHITECTURE.md, TESTING.md.

## Rules

- **Core owns behavior.** Any rule describable in a sentence (amount parsing, list order, valid transaction) lives in `packages/core` with a test; screens hold plumbing only. `packages/core/tsconfig.json` has `"types": []` so core cannot touch Node/DOM/RN APIs.
- **Money is integers** (cents), formatted only at the edge. `parseAmount` REFUSES `1.005` rather than rounding.
- **The device is the only copy.** A store that won't parse is never an empty store: `parseStore` returns an error, the app renders it, nothing writes until a person chooses to discard. Before adding any save path, ask what it does on top of a failed load.
- **`spec/` is the contract.** Change a vector, watch it red, make it green; a behaviour change touching no spec file is uncovered.
- **Tests with the change.** Change a feature, change its test in the same commit; new feature, new test; bug fix, the case that would have caught it. A quick deploy never skips a gate.
- **CalMind is the reference, never a source.** Grep it before inventing an approach; read before copying; never IMPORT from it (another agent works there). Check `~/GIT/CalMind/apps/app/modules/watch-bridge` and `packages/core/src/sync.ts` (`Math.max(now, prev.updated + 1)` stamps every write, deletes included).
- **Budget tab reads ONE month**: `monthSet(prefs.budgetMonth)` is the only set; no view dropdown, no `budgetView` pref, `View`, `viewSet`/`viewsOf`, `ViewPick.tsx`. `ALL_TIME` stays (key for `Line.budget`).
- **Never migrate away records for a removed feature.** Old files still load, report zero dropped rows, keep `v:` budget amounts unread; store stays v4. `store.test.ts` pins this.
- **Pick bar**: `apps/app/src/PickBar.tsx` is a `fork` of CoreMind `canon/app/src/components/PickBar.tsx` (ChefMind is the `exact` row). Ours: `detail`, `extras`, optional `onDelete` (omitted on budget). Changing All/Clear/two-press Delete (controls, order, 2.5s fuse) is owed to ChefMind and canon too.
- **Canon bytes, do not edit here**: `packages/core/src/rowslots.ts`, `packages/core/src/folds.ts`, `packages/core/test/folds.test.ts`. Change goes home repo → canon → every consumer, or CoreMind's `bin/check-drift.sh` lies (it lives there, not here). `orderAbove`/`OrderDir` are ours.
- **iCloud is the only cloud link**: the ledger is `store.json` in the iCloud Drive container, decided by core's `planSync` (`ubiquity.ts`); the iPhone moves it through `modules/icloud-file`, the Mac Tauri shell by path (`desktop/src-tauri/src/main.rs`, macOS only). Windows, Android and web have no sync. `server/` is the web doorway and holds no data.
- **Cog, not bar**: app-wide, once-a-session controls (Import from CSV, Export budget, Whole dollars) live in `AppMenu.tsx` behind the top-right cog; the bar is per-screen. One setting, one control.
- **Write only `/AcctMind` and `/test/AcctMind`** (CalMind's areas never). Destinations are guarded constants, never variables; prove guards by breaking copies of the script, never the real one.
- **Deploy to both**: `./deploy.sh` writes sandbox then production until Sean says test-only (then one line changes).
- **Lane exits non-zero when a device build is owed** though the release shipped (live, tagged, status card `ok` severity 2); CoreMind's batch still ships later repos.
- **Versions**: `version` is semver in SIX files held by `tools/check-version.mjs`: root `package.json`, `apps/app/package.json`, `app.config.js`, `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`. Tags match, BARE (no `v`); patch tags fine. `Cargo.lock` is not compared; `tools/sync-lock-versions.mjs` (run by the lane) syncs it.
- **`ios.buildNumber`** is HAND-bumped every time a build leaves this machine; restarts at 1 with the minor bump. Verify bumps (a `sed` matching nothing reports success); check-version also compares the generated `Info.plist`.
- **`app.config.js` is source; `apps/app/ios/` is prebuild output.** Bumping config without `expo prebuild` installs the old number. `npm run test:version:device` (run by `tools/build-platforms.sh --ios` around prebuild; one regeneration then re-check) guards it; `npm test` runs `test:version` (`--sources-only`), where a stale plist is the normal state.
- **Heavy builds**: `tools/build-platforms.sh` blocks and `desktop/smoke.sh` (when building) run under `tools/heavy-lock.sh` (CoreMind `canon/tools/heavy-lock.sh`, `exact` row: fix it there). Waits up to 30 min; nested heavy blocks are refused (macOS block calls smoke with `--no-build`). Lockless lanes (TestMindSuite forks, WriteMind xcodebuilds) are unseen: serialize by hand.
- **No watch target.** Removed: `apps/app/targets/watch/`, `apps/app/modules/watch-bridge`, `packages/core/src/watch.ts`, `apps/app/src/watch.ts`, `tools/check-watch-feed.sh`, `test:watch`, `@bacons/apple-targets`. Restore = revert that commit + plugin line in `app.config.js` + watch render line in `tools/make-icons.sh`. Keep the watch traps below.
- **`tauri.conf.json` takes NO extra keys** (a `"_note"` fails the schema); its notes live here. NO `dmg` in `bundle.targets` (create-dmg needs Finder/AppleScript, fails after a good `.app`). `msi`/`nsis` are config-only (no cross-compile).

## Shorthand

- **`npm run dtp` / `npm run tdtp`** (`tools/dtp.sh`, `tools/tdtp.sh`), in order:
  1. **Test** (tdtp only): `npm test`, all of it, first.
  2. **Deploy**: `./deploy.sh --quick` (dtp) or `./deploy.sh` (tdtp); both write sandbox then production, with gates (quick = seconds-cost gates plus spot test). tdtp skips the repeat gesture suite when the export keys (`tools/dist-key.mjs`) match what `npm test` ran.
  3. **macOS**: `tools/build-platforms.sh --mac` from a clean export, BEFORE the tag (a broken bundle leaves the version untagged; a re-run reuses it).
  4. **Tag**: annotated, at the new version, bare.
  5. **Push**: `git push --atomic --follow-tags origin main` (on rejection the local tag comes off); then dispatch desktop-windows.
  6. **Devices**: iOS to phone, Android to emulator, AFTER the push, reported not fatal.
- A platform flag selects only it; none = all three; `--web` = release with no platform builds.
- Deploy gates include `npm run test:server`; a red server suite blocks both lanes, correctly.
- `sh bin/dtp.sh all --full --platforms` (from CoreMind) drives the suite's tdtp; AcctMind SELF-SHIPS (CoreMind detects `tools/build-platforms.sh`, passes `--platforms` through, and reads a tag at HEAD as "shipped, device build owed").

## Platforms

- **Web**: prod `seancheren.com/AcctMind`, test `test.seancheren.com/AcctMind`; `./deploy.sh` writes both.
- **Windows**: `.github/workflows/desktop-windows.yml` on a Windows runner, dispatched by the push step. Local ledger only: no iCloud path (`store_path()` is macOS-only).
- **macOS**: Tauri bundle in `desktop/`, built by `tools/build-platforms.sh --mac`, smoke-tested with `desktop/smoke.sh --no-build`, copied to `/Applications` and the copy verified. "My Mac (Designed for iPad)" from `apps/app/ios` is NOT this surface (Xcode GUI only).
- **iOS**: `tools/build-platforms.sh --ios`; AcctMind goes on Sean's handset only (phone list by udid in the script). Switched-off phone skipped, refusing phone warned, fails only if none took it. Team 2LGYTL3FSJ is PAID: no per-phone app cap.
- **Android**: `tools/build-platforms.sh --android` (local emulator).
- **No watchOS.**

## Commands

```sh
npm -w @acctmind/core run test -- --run txn          # one core file, by path fragment
npm -w @acctmind/core run test -- --run -t 'a tap'   # one core test, by name
npx playwright test e2e/money.spec.ts                # one spec, both viewports
npx playwright test e2e/money.spec.ts --project=chromium -g 'minus KEY'
npx playwright test --ui                             # watchable
```

- Run the narrowest test that can still fail; `npm test` takes minutes.
- e2e refuses a stale export (`e2e/freshness.ts` vs `dist/build.json`): after any source edit run `npm run export:web` first, or `npm run test:e2e`; `test:e2e:fast` skips the export.
- No linter or formatter. `npm run typecheck` = three projects (core, core tests, app).

## Traps

- **Ledger sorts DESCENDING (`sortTxns`), budget lines ASCENDING (`linesIn`)** → `orderBetween` sent drags to an END to the opposite end → `OrderDir` is an argument; ask what the second list does differently before reusing a helper.
- **A child `Pressable` answers the tap before the row** → modes (parked swipe delete) must reach every child → one rule, core's `rowTap`, read once per row.
- **`PanResponder` ignores Playwright `page.mouse`** → drive swipes with CDP `Input.dispatchTouchEvent` (`swipeRow` in `e2e/helpers.ts`; Chromium only, mobile project is WebKit). Re-test any "cannot be driven" claim.
- **RNW `Modal` sliding out still traps focus ~250ms** → `autoFocus` in a new Modal is pulled away (OpAmount re-takes focus for 250ms). `fill()`/`pressSequentially()` focus first and hide it; test with `page.keyboard`.
- **Backticks in `git commit -m "…"` are command substitution** → word silently dropped → message via heredoc to file, `git commit -F`.
- **Side effect inside a `setState` updater restarts the render and discards batched updates** (add form stayed open) → updaters pure; call the effect in the handler. Pinned by `e2e/add.spec.ts`.
- **`npx expo run:ios` (simulator) never exits and leaves processes that race (`database is locked`)** → screenshots of the wrong binary → never use it; there is NO simulator script (TESTING.md: simulator run was by hand). Use `tools/build-platforms.sh --ios` (device-only). If screenshot and code disagree, check the build installed.
- **`npx expo run:ios --device` hangs on a locked phone after the build** → `xcodebuild … build` then `xcrun devicectl device install app` (installs when locked; only launch needs it awake).
- **CocoaPods `Encoding::CompatibilityError`** → `export LANG=en_US.UTF-8` before `pod install`.
- **Script ending in `echo` reports success** (relative path from wrong cwd) → log `echo "BUILD_STATUS=$?"` and grep that, never the task's exit code.
- **Backdrop revealed by a gesture needs an OPAQUE row** (swipe-delete red showed through at rest; `toBeVisible()` can't tell) → assert computed style: `rowactions.spec.ts` checks `backgroundColor` is not `rgba(0, 0, 0, 0)`.
- **RNW leaves a hidden `Modal` in the DOM** → `querySelector` presence checks lie → assert `toBeVisible()`/`toBeHidden()`.
- **`set -e` is inherited by `$(…)` subshells** → `status=$(cmd; echo $?)` exits silently on failure → `if cmd; then … else … fi` (bit `tools/check-deploy-guards.sh`).
- **Base-36 timestamps sort lexicographically only at fixed width** → `newId` prefix is padded; do not unpad.
- **`render_login()` needs the caller to define `e()`** (else dies mid-`<head>`, renders broken page) → `server/public/index.php` defines it, guarded.
- **An `index.html` in web root bypasses sign-in** (Apache `DirectoryIndex` lists it first) → deploy excludes it, app shell lives outside web root, `.htaccess` pins `DirectoryIndex index.php`, deploy checks the server afterwards.
- **One export cannot serve both paths** (`/AcctMind` bundle under `/test/` loads the other instance's chunks) → `deploy.sh` exports once per instance and refuses an export whose stamp names the wrong base. Today the bundles differ only in `index.html` (no `import()`, no async chunks); the first `import()` makes it real.
- **Expo `Module` is not an `NSObject`** → cannot be a `WCSessionDelegate` → own `NSObject` subclass, held (WCSession holds delegates weakly). Uncompiled Swift is unwritten: `xcodebuild -scheme <PodName>` compiles a pod alone.
- **`NWBrowser` omits the TXT record by default** → peer filter finds nothing, both sides `ready` and `dns-sd -B _acctmind1._tcp` lists both, apps never see each other, no error → use `.bonjourWithTXTRecord(type:domain:)`. A filter's `continue` on missing input looks like "no match": make it loud.
- **`-destination 'generic/platform=iOS Simulator'` builds the watch target against the iOS SDK** → absurd errors → `-destination 'platform=iOS Simulator,id=<udid>'`; watch via `-scheme AcctMindWatch -destination 'platform=watchOS Simulator,id=<udid>'`.
- **A test mutating a hard-coded value dies when the algorithm changes** (`peer.test.ts`, Luhn → sum stayed green) → DERIVE the fixture from the code under test and assert the underived fixture is valid first.
- **A frame counter is not a rate limit** (peer link's 8-frame cap broke real sync) → bound arrival RATE with a token bucket.
- **Core imports are extensionless** (Metro can't resolve `./money.js`, Node ESM can't resolve `./money`) → `tools/register-ts.mjs` lets Node scripts import core.
- **`click()` on a gone control waits out the whole test budget** → `actionTimeout` in the Playwright config, short explicit timeout on speculative clicks.
- **`hitSlop` is a no-op under react-native-web** → draw controls at `TAP` (44pt); never shrink and add `hitSlop`.
- **RN `Modal` is its own window outside the safe area** (under the clock; invisible in browser tests) → all TEN modals re-apply `useSafeAreaInsets`: AddTransaction, AmountPad, AppMenu, CategoryPick, DayPicker, Devices, Import, Manage, SectionPick, SortPick. An eleventh needs it too. (Listed as nine with `LineEditor` until 2026-10-21 — that file went with the budget's edit screen, and the list had missed AppMenu and Import, the two newest and so the two a reader is most likely writing beside.)
- **Comments state intent; code may have drifted** → read one against the other.
- **`dist` may hold several `index-*.js`** (CalMind) → read the entry from `dist/index.html`, not `find | head -1` (as `desktop/smoke.sh`, `desktop/check-assets.sh` do). Here `expo export` wipes `dist` and there is one; true until the first `import()`.
- **Ask what a failed write does**; grep `.catch(() => {})` and triage by what is lost.
