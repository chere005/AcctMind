# AcctMind

Feel free to deploy this on your own website, build and deploy the iOS version, etc.

**This is a personal project to have some fun with claude code, which generated essentially all of the code, and the rest of this readme:**

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

**On the device.** There is no API and no database. The web app keeps its
ledger in the browser's own storage; the phone, the watch and the desktop
shells keep theirs on the machine.

That has one consequence worth stating plainly, because the code is shaped
around it: **the device is the only copy**, so a store that will not parse is
never treated as an empty one. `parseStore` returns an error rather than an
empty ledger, and the app refuses to write until a person says to discard it.

## Sync, and what each transport actually does

Three links, none of which needs Sean's server, all of which are optional —
every surface is a working app with all three switched off. What merges is
one function (`mergeStores`), proven commutative, associative and idempotent,
so any of them can deliver in any order, twice, or years late.

| Link | Between | Needs | State |
| --- | --- | --- | --- |
| Local network | iPhone ⇄ Mac ⇄ iPad | A free Apple team | **On** |
| WatchConnectivity | iPhone → Watch | A free Apple team | On, one-way |
| iCloud key-value | Any Apple devices | A **paid** membership | Written, off |

**Local network** is Bonjour discovery and a TLS connection carrying whole
ledgers, `apps/app/modules/peer-sync/`. Two devices pair once by typing a
25-character code; that code is 120 bits from the system CSPRNG and becomes
the pre-shared key, which is why it is long rather than six friendly
characters — a short one could be ground out offline by anyone who recorded a
handshake off the wifi.

The link is TLS, authenticated by that code — measured as TLS 1.2 with
`TLS_PSK_WITH_AES_128_GCM_SHA256`, which is what Apple's pre-shared-key
support negotiates and cannot be talked out of. So nobody on the network can
read the ledger or feed it invented rows. It has **no forward secrecy**,
which is worth knowing precisely: someone who both records a session and
later gets the pairing code could read what they recorded. The code never
crosses the network and lives in the Keychain, so that means having the
device. `PeerLink.swift` carries the full note.

Its other limit is real and the app says so rather than showing a tick:
**both devices have to be awake, on the same network, with AcctMind open.** iOS
suspends a backgrounded app and a suspended app holds no listener. A
transaction added on a phone in a café reaches the Mac the next time both are
open together.

**iCloud** removes that limit — a device that was switched off gets the write
on its next launch — but the key-value entitlement needs a paid Apple
Developer Program membership. The code is written and tested; it is gated
behind `ACCTMIND_ICLOUD=1` and off by default, so a free team builds
everything.

**The watch** gets a feed, not the store: the twenty most recent rows and the
total of *all* of them. It draws; it does not edit.

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
apps/app/modules/         Three small native modules, all Apple-only and all
                 no-ops elsewhere: peer-sync (Bonjour + TLS), watch-bridge
                 (WatchConnectivity), icloud-sync (key-value store). Each
                 moves opaque strings; none of them merges anything.
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
npm run test:peer                 # the Bonjour service type, plist against core
sh desktop/check-assets.sh        # the desktop's cheap checks
./desktop/smoke.sh                # macOS: build, carry THIS export, launch, quit
cd apps/app && npx expo start     # then i / a for the iOS / Android simulator
```

The Mac app is the iOS binary run natively — no Catalyst, no second codebase,
and the same bundle identifier as the phone, which is what would let the two
share a pairing. It builds:

```sh
cd apps/app/ios && xcodebuild -workspace AcctMind.xcworkspace -scheme AcctMind -configuration Release -destination 'platform=macOS,variant=Designed for iPad' build
```

**But you cannot launch what that produces from a shell**, and that is worth
knowing before planning around it. The product is a `platform 2` (iOS) Mach-O
in `Release-iphoneos/`, which is correct for "Designed for iPad" — and macOS
refuses it: `open` says "incorrect executable format", and registering it with
`lsregister` changes nothing. Running one of these locally is an Xcode action:
open `apps/app/ios/AcctMind.xcworkspace`, choose **My Mac (Designed for
iPad)**, Run. There is no command-line equivalent.

The alternative, if a double-clickable Mac app is ever wanted, is Mac
Catalyst. Expo sets `SUPPORTS_MACCATALYST = NO` and turning it on is a real
piece of work rather than a flag — it needs a config plugin (prebuild
regenerates the project) and every Pod has to tolerate the Catalyst SDK. It
has not been attempted.

Android needs `ANDROID_HOME` in the environment — `expo run:android` sets it,
a bare `./gradlew` does not, and the failure ("SDK location not found") reads
like a broken project rather than a missing variable:

```sh
cd apps/app/android && ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew assembleRelease
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

## License

BSD 3-Clause — see [LICENSE](LICENSE). Do what you like with it: use it,
change it, fold it into something else, commercially or not, no permission
needed and no warranty given. The two things the licence does ask are that
the copyright notice travels with the source, and that you don't use Sean's
name to endorse whatever you build from it.

The same licence CalMind and seancheren-site use, so the repositories agree
rather than each having their own answer.

The dependency tree is MIT/ISC/Apache/BSD throughout, with no copyleft that
would conflict with the App Store's terms. `node-forge` reports
`BSD-3-Clause OR GPL-2.0`; it is dual-licensed, the BSD side applies, and it
is build tooling that never reaches the binary.
