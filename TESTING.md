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

**`tools/check-watch-feed.sh`** — the watch is a separate process in another
language, so `formatAmount` exists twice: once in `packages/core/src/money.ts`
and once in `apps/app/targets/watch/Feed.swift`. This lifts the real Swift out
of the target (never a retyped copy — that tests the typist), compiles it,
feeds it what `watchFeed()` really produces, and compares the drawn strings.
Two copies with a test between them.

## What nobody is watching

- **That the desktop window actually RENDERS.** A window showing an error page
  launches, survives eight seconds and quits exactly like a working one. The
  smoke guards the specific failure that caused it in CalMind — the window
  opening a path the embedded assets do not have — by reading the asset paths
  out of the built binary. It does not watch pixels. Proving that needs
  screen-recording permission or a probe build.
- **The phone and the watch, on real hardware.** The web harness runs a phone
  VIEWPORT, which is not a phone: a browser has no status bar to hide under,
  and `hitSlop` is a no-op under react-native-web while it works on native.
  Open the simulator and look.
- **The watch's transport.** The feed shape is proven and the decoder is
  proven. Nothing yet carries the feed from the phone to the wrist — see
  `apps/app/targets/watch/AcctMindWatch.swift`.
- **iOS and Android builds.** `ios/` and `android/` are `expo prebuild`
  output and disposable; nothing builds them on a schedule.

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
  out.

A check nobody has seen fail is a check nobody should trust. Five green
checks in CalMind turned out to be worthless in a single session.
