# AcctMind

A ledger. One list of transactions, on every screen Sean owns.

This is the first commit: documentation and nothing else. The template it
describes gets built next, deliberately in that order — the shape is agreed
before there is code to argue with.

AcctMind is CalMind's architecture applied to money. CalMind
(`~/GIT/CalMind`) proved that one TypeScript brain can drive web, iOS,
Android, macOS, Windows and a watch without any surface owning a rule.
AcctMind starts from that shape rather than rediscovering it, and starts
*small*: the whole product, for now, is a list and an add form.

## What it does, in full

One screen, headed **Transactions**, listing them. A **+** opens a form:

| field | notes |
|---|---|
| Name | required |
| Description | free text |
| Amount | currency |
| Date | a picker, defaulting to today |

That is the entire feature set on purpose. Everything after this is a small
incremental request against a template that already deploys and already has
a test suite watching it — which is the actual point of the exercise.

## Where it goes

`https://example.com/AcctMind` — NearlyFreeSpeech, same host as the
CalMind suite. Nothing in this repo may write CalMind's areas.

## The six surfaces

Planned, none built yet. The mapping is CalMind's, which is why it is short:

| surface | how |
|---|---|
| web | Expo web export (react-native-web), served at `/AcctMind` |
| iOS | the same Expo app, prebuilt to Xcode |
| Android | the same Expo app |
| watch | a SwiftUI target inside the iOS app |
| macOS | a Tauri shell around the identical web export |
| Windows | the same Tauri shell, built on a Windows CI runner |

Six surfaces, two builds and a shell. No surface gets its own copy of a
rule; if it needs one, the rule was in the wrong place.

## The planned map

```
packages/core/   The brain. Money, dates, sort order, validation — shared
                 verbatim, consumed as TypeScript source, no build step.
spec/            The behavior contract as JSON vectors. Changing what
                 AcctMind DOES starts here, not in a screen.
apps/app/        One Expo app -> iOS, Android, web. Screens and gestures
                 only; behavior is imported from core.
apps/app/targets/  The SwiftUI watch app, generated into the Xcode project.
server/          The API in plain PHP, deployable to NFSN unchanged.
desktop/         Tauri 2 shell around the web export -> macOS and Windows.
e2e/             Playwright, driving the real export against the real API.
tools/           The checks no browser can reach, and the deploy guards.
```

## The two suites

Both are built alongside the features, never after — a suite retrofitted to
code that already shipped tests what the code does, not what it should.

- **Quick** (`npm run deploy:quick`) — the fast lane for a one-line fix.
  Every gate that costs seconds, plus a spot test, then it ships. Minutes.
- **Full** (`npm test`) — everything: core, server, gestures, WebKit, the
  native seams, the deploy guards. Runs before anything that matters.

`AGENTS.md` is how to work in here. `TESTING.md` will be the map of which
harness watches what, once there are harnesses to map.
