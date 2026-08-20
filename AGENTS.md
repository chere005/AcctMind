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

## Traps that have cost real time HERE

- **A side effect inside a `setState` updater silently discards the other
  updates batched with it.** `setPhase(p => { save(...); return next; })`
  looks harmless. React treats a state update raised during an updater as a
  render-phase update and RESTARTS the render — so the `setAdding(false)`
  queued alongside it was thrown away, the transaction saved perfectly, and
  the add form stayed open. Updaters are pure. Compute from current state in
  the handler and call the effect there. Pinned by `e2e/add.spec.ts`.

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
