# Working on AcctMind

Sean's ledger. `README.md` is the map. This file is how to work in here.

The repo is one commit old, so most of what follows is **inherited** — rules
and traps that cost real time in CalMind (`~/GIT/CalMind`), whose
architecture this is. They are written down before they can be rediscovered.
Anything learned *here* gets added here, in the commit that learns it.

## Standing rules

- **Behavior lives in `packages/core`.** A screen holds plumbing. If you can
  describe a rule in a sentence — how an amount is parsed, how the list is
  sorted, what a valid transaction is — it belongs in core, with a test.
  Six surfaces means a rule written in a screen is a rule written wrong five
  more times.

- **Money is integers.** Amounts are stored and computed in minor units
  (cents) as integers, formatted only at the edge where they are displayed.
  Floats are for physics. This is an accounting app: a cent that goes
  missing in a rounding step is the one bug the product cannot have.

- **`spec/` is the contract.** Changing what AcctMind does starts by
  changing a vector, watching it go red, then making it green. A behavior
  change that touches no spec file is either not a behavior change or is
  not covered.

- **CalMind is the reference, not the source.** Grep it before inventing an
  approach — the Expo/Tauri/PHP seams, the deploy guards, the watch bridge
  are all solved there. But nothing is copied without being read: CalMind
  carries five years of a different product's decisions, and a paste that
  brings its assumptions along is a paste that brings its bugs along.

- **Nothing in this repo may write CalMind's areas.** `/AcctMind` on the
  server is this app's, and nowhere else is. The deploy script's
  destinations are guarded constants, never variables — and the guards get
  proven by breaking copies of the real script, never the real script.

- **Web first.** Deploy the web surface before building a device. The web
  deploy runs the gates; a device build that goes first is a build made
  against code no gate has passed.

- **`main` is the branch.** Stage explicit paths — never `git add -A`.
  Sean makes his own commits unless he says otherwise.

- **Ask what happens when a write fails.** The worst bugs CalMind found
  were all silent: a record dropped while the UI said "saved", a damaged
  store reading as an empty account. Search for `.catch(() => {})` and
  triage each one by what is lost.

## Traps, inherited

Each of these cost real time in CalMind. None of them are hypothetical.

- **The shell's working directory persists between Bash calls.** A `cd` into
  a subdirectory silently breaks the next command's relative paths. Use
  absolute paths.

- **A check that cannot fail looks exactly like one that passes.** Five
  green checks turned out to be worthless in a single CalMind session — a
  grep for the empty string, an assertion on a container that was not there.
  Before trusting a new test, break the thing it guards and watch it go red.

- **A `click()` on a control that has gone does not fail fast.** It waits
  out the whole test budget and reads as a hang. Every speculative click
  needs its own short timeout:
  `click({ timeout: 1_500 }).catch(() => {})`.

- **`hitSlop` is a no-op under react-native-web.** A control is exactly as
  big as it is drawn on the web and bigger on native — the two disagree
  silently, in the direction that hurts Safari on a phone. When a press has
  to work, measure the box.

- **A React Native `Modal` is its own window, outside the safe area.**
  Anything absolutely positioned in one sits under the clock. Invisible in
  every browser test — a browser has no status bar to hide under. The add
  form is a modal, so this one is aimed directly at us.

- **Comments state intent; the code may have drifted.** Two real CalMind
  bugs came from reading one against the other.

- **`dist` holds more than one `index-*.js`.** Read the entry name out of
  `dist/index.html` rather than `find | head -1`, and compare index.html to
  index.html when asking whether a deploy landed.

## The bargain on tests

Change a feature, change its test in the same commit. Add a feature, add a
test with it. Fix a bug, add the case that would have caught it.

Both suites get built alongside the code, never retrofitted. The quick lane
exists so that a small fix is cheap to ship; it stays honest by keeping
every gate that costs seconds and swapping only the ones that cost minutes
for a spot check. A quick deploy that skips a gate to be quick is just a
deploy with a gate missing.
