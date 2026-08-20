# AcctMind

A ledger. One list of transactions, on every screen Sean owns.

Six surfaces — web, iOS, Android, watch, macOS, Windows — from two builds and
a shell. Every rule the product has is written once, in TypeScript, and every
surface renders it. The whole feature set today is a list and an add form,
deliberately: the point of this commit is a template that already deploys and
already has a suite watching it, so that everything after it can be a small
request.

The architecture is CalMind's (`~/GIT/CalMind`), applied to money and started
from scratch rather than rediscovered.

## What it does, in full

One screen, headed **Transactions**, listing them, with the running total
under the title. A **+** opens a form: **Name** (required), **Description**,
**Amount**, and a **Date** button that opens a month grid and starts on today.

## Where the data lives

**On the device, and nowhere else.** There is no API, no database, and no
sync. The web app keeps its ledger in the browser's own storage; the phone
and the desktop shells keep theirs on the machine. Nothing about a
transaction is ever sent anywhere.

That has one consequence worth stating plainly, because the code is shaped
around it: **the device is the only copy**, so a store that will not parse is
never treated as an empty one. `parseStore` returns an error rather than an
empty ledger, and the app refuses to write until a person says to discard it.

Sync later — if it comes — should not need Sean's server. The store is behind
one small interface (`apps/app/src/persist.ts`) for that reason.

## The sign-in, and what it is for

The web build is on the open internet, so that surface asks who you are. It reuses the live suite's sign-in exactly: same accounts, same
password, same session cookie — which already covers the whole domain, so
being signed into the suite signs you into this.

That is the entire server side. `server/public/index.php` decides whether to
hand over the page and serves it; there is nothing else there, and no user
data for it to hold. **No other surface has a login** — the phone, the watch
and both desktop shells read a ledger that never left the machine, and a
password on those would protect nothing.

## The map

```
packages/core/   The brain, shared verbatim by every surface: money in
                 integer cents, days as local YYYY-MM-DD, the month grid,
                 validation, ordering, the store's damage handling, and the
                 watch feed. No dependencies, no build step — consumed as
                 TypeScript source. Its typecheck forbids Node, DOM and
                 React Native types, so "core is platform-neutral" is a
                 checked property rather than a convention.
spec/            The behavior contract as JSON vectors — the same file a
                 native port would replay. Changing what AcctMind DOES
                 starts HERE, not in a screen.
apps/app/        One Expo app -> iOS, Android and web. Screens, gestures and
                 styling only; every rule is imported from core.
apps/app/targets/watch/   The SwiftUI watch app, generated into the Xcode
                 project by @bacons/apple-targets. Read-only. Its formatter
                 is a deliberate twin of core's, held to it by
                 tools/check-watch-feed.sh.
server/          The doorway, in plain PHP. Roughly forty lines that reuse
                 the suite's sign-in and serve the app shell.
desktop/         A Tauri 2 shell around the identical web export -> macOS
                 locally, Windows on a CI runner.
e2e/             Playwright: the real export at the real base path, driven
                 by real mouse events, on desktop and phone viewports.
tools/           The checks no browser can reach — the deploy guards, the
                 Swift seam, the export's head patch and build stamp.
```

## Running it

```sh
npm install                       # once, at the root
npm run test:dev                  # the between-runs suite — under a minute, no browser
npm test                          # core + server + the full gesture run
npm run web                       # Expo web on :8081
npm run export:web                # the dist every shell and the e2e suite run on
npx playwright test --ui          # the gesture suite, watchable
npm run test:watch                # core's real feed through the watch's real Swift
sh desktop/check-assets.sh        # the desktop's cheap checks
./desktop/smoke.sh                # macOS: build, carry THIS export, launch, quit
cd apps/app && npx expo start     # then i / a for the iOS / Android simulator
```

`export:web` is the export PLUS `tools/patch-web-html.mjs` — the head patch
and the build stamp ride in it, and a bare `expo export` ships an index.html
that renders a white strip above a dark app on an iPhone. Nothing should call
it directly.

## Deploying

```sh
cp deploy.conf.sample deploy.conf   # once: set SSH_DEST and SITE_URL
./deploy.sh                         # the sandbox AND production, sandbox first
./deploy.sh --quick                 # the fast lane for a small fix
./deploy.sh --verify                # read-only: what is each instance serving?
```

Both instances, every time — Sean's call, 2026-08-20, and it stays that way
until he says to switch to test-only.

The two destinations are guarded constants in `deploy.sh`, and the guard is an
ALLOW-LIST: those two paths are writable and every other path on the host —
the site root, a neighbouring app's area, even a differently-cased spelling of
our own — is refused. A deny-list would only refuse the mistakes somebody
thought of. The host's address is not in this repo at all; it lives in
`deploy.conf`, and it is used only to prove a deploy landed, never to decide
where anything is written. Every guard is re-proven on each run of
`npm run test:deploy` by breaking a copy of the script and watching it stop.

`TESTING.md` is what the tests are worth. `AGENTS.md` is how to work in here.
