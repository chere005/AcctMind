# AcctMind

Feel free to deploy this on your own website, build and deploy the iOS version, etc.

**This is a personal project to have some fun with claude code, which generated essentially all of the code, and the rest of this readme:**

A ledger. One list of transactions, on every screen Sean owns.

Five surfaces — web, iOS, Android, macOS, Windows — from two builds and
a shell. Every rule the product has is written once, in TypeScript, and every
surface renders it. Two tabs today — a ledger grouped by account, and a
two-level budget — plus the optional sync links below.

The architecture is CalMind's (`~/GIT/CalMind`), applied to money and started
from scratch rather than rediscovered.

## What it does, in full

Two tabs, on a bar at the bottom.

**Transactions** groups every row under an **account** — a current account, a
card, cash in a drawer. Each section folds shut, carries its own running
total, and has its own **+** that adds into that account. A collapse-all sits
in the row under the title, with the `.00` toggle and the sort. The section
picker, up in the top bar after the pencil, is CalMind's round colour button:
one account shows its colour, all of them show the rainbow.

Rows are ordered by **date**, by **amount** (on the absolute value — sorted
signed, the largest expense sinks below every small credit), or by **hand**.
The hand order rides on the record, so the Mac agrees with the phone; the
other two are device preferences. An untouched list looks identical in all
three.

**A single tap** on a row's name or amount edits it in place, and a tap on the
date opens the day grid — the common change costs one tap and never leaves the
list. The **pencil** in the top bar is edit mode, where every row at once
grows four small circles over its right side (edit, duplicate, copy, delete)
and rows can be picked out; pick several and the bar under the title reports
what they come to. **Swipe left** to park a delete button; one more tap on it
deletes, and a tap anywhere else puts it away. None of this moves the row, so
nothing shifts under a thumb that is already aiming. In **Custom** order the
pencil also grows a grip on the left of each row, and rows are dragged by it —
custom order alone is not enough, because a hand order the next render would
undo reads as the app ignoring you. Its space is reserved in every order and
every mode, so neither switching sort nor opening the pencil ever slides a
name sideways.

**Budget** is two levels. A **category** is a heading with a name and a colour
and no money of its own; the **+** beside it adds a **line**, and a line is
what holds a budget and what a transaction is filed against. Each line shows
three numbers:

| | |
|---|---|
| **Budgeted** | set aside. The only one of the three that is stored. |
| **Spent** | the sum of the line's transactions. Read-only — a budget screen that let you type over the money that actually moved would be a budget screen that lies. |
| **Available** | budgeted **plus** spent. Money out is negative, so it is a sum. |

Tapping either editable number opens a small **pad over the list** — not a
screen instead of it, because changing one figure is a two-second thought and
a full editor hides the list you were reading to decide. The pad has the
amount and **=**, **+**, **−** underneath, **defaulting to +**: adjusting is
the common case and setting is the one worth a deliberate tap. `+` and `−`
work from the value as it stood when you chose the operator, so typing two
digits does not compound. Tapping the line's NAME opens the whole line, to
rename or remove it.

Edit **either** budgeted or available and the other follows, because they are
two views of one stored number.

Categories and accounts are made in one **Manage** screen, reached from the
last row of either picker — and nowhere else, so there is one place that knows
what a new one starts as.

The add form takes a **Name**, a **Category** (a dropdown of lines, grouped by
category, that filters as you type), an **Amount**, and a **Description**. The
date is a small calendar beside the name, starting on today.

**Amounts fill from the cents.** `450` is $4.50 and `1234` is $12.34, the way
a card terminal works, because nearly every amount in a ledger has cents in
it. A typed `.` overrides that — `50.` is $50.00 — and a **.00** toggle in the
row under the title flips the default for anyone entering round numbers all
afternoon. The
value formats where it is typed.

**The sign is a button, and only a button.** A **−** sits left of the field and
holds it; the field itself takes digits and at most one dot, so a typed minus
is dropped like a `$` or a comma. It read the leading `-` too until 0.11.0,
which meant the minus was drawn twice — once by the button and once in the
text, a cursor away from being edited into something else. A new transaction
starts negative, because almost everything in a ledger is money going out.

## Where the data lives

**On the device.** There is no API and no database. The web app keeps its
ledger in the browser's own storage; the phone and the desktop
shells keep theirs on the machine.

That has one consequence worth stating plainly, because the code is shaped
around it: **the device is the only copy**, so a store that will not parse is
never treated as an empty one. `parseStore` returns an error rather than an
empty ledger, and the app refuses to write until a person says to discard it.

## Sync, and what each transport actually does

Two links, neither of which needs Sean's server, both optional — every
surface is a working app with both switched off. What merges is
one function (`mergeStores`), proven commutative, associative and idempotent,
so any of them can deliver in any order, twice, or years late.

| Link | Between | Needs | State |
| --- | --- | --- | --- |
| Local network | iPhone ⇄ Mac ⇄ iPad | A free Apple team | **On** |
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

## The sign-in, and what it is for

The web build is on the open internet, so that surface asks who you are. It reuses the live suite's sign-in exactly: same accounts, same
password, same session cookie — which already covers the whole domain, so
being signed into the suite signs you into this.

That is the entire server side. `server/public/index.php` decides whether to
hand over the page and serves it; there is nothing else there, and no user
data for it to hold. **No other surface has a login** — the phone
and both desktop shells read a ledger that never left the machine, and a
password on those would protect nothing.

## The map

```
packages/core/   The brain, shared verbatim by every surface: money in
                 integer cents, days as local YYYY-MM-DD, the month grid,
                 validation, ordering, and the store's damage handling.
                 No dependencies, no build step — consumed as
                 TypeScript source. Its typecheck forbids Node, DOM and
                 React Native types, so "core is platform-neutral" is a
                 checked property rather than a convention.
spec/            The behavior contract as JSON vectors — the same file a
                 native port would replay. Changing what AcctMind DOES
                 starts HERE, not in a screen.
apps/app/        One Expo app -> iOS, Android and web. Screens, gestures and
                 styling only; every rule is imported from core.
apps/app/modules/
                 Two small native modules, both Apple-only and both no-ops
                 elsewhere: peer-sync (Bonjour + TLS) and icloud-sync
                 (key-value store). Each moves opaque strings; neither of
                 them merges anything.
server/          The doorway, in plain PHP — index.php, an .htaccess that
                 pins DirectoryIndex, and the suite that tests them. Under
                 seventy lines of code in a 185-line file; the rest is the
                 note on why it is that short.
desktop/         A Tauri 2 shell around the identical web export -> macOS
                 locally, Windows on a CI runner.
e2e/             Playwright: the real export at the real base path, on
                 desktop and phone viewports. Mouse for most of it; the
                 swipe needs a real touch stream over CDP, which is
                 Chromium-only — see TESTING.md.
tools/           The checks no browser can reach — the deploy guards, the
                 Swift seam, the export's head patch and build stamp.
```

## Running it

```sh
npm install                       # once, at the root
npm run test:dev                  # the between-runs suite — under a minute, no browser
npm test                          # core + server + the full gesture run
npm run web                       # Expo web on :8083 (pinned — 8081 is where
                                  #   CalMind's bundler answers)
npm run export:web                # the dist every shell and the e2e suite run on
npx playwright test --ui          # the gesture suite, watchable
npm run test:peer                 # the Bonjour service type, plist against core
sh desktop/check-assets.sh        # the desktop's cheap checks
./desktop/smoke.sh                # macOS: build, carry THIS export, launch, quit
cd apps/app && npx expo start     # then i / a for the iOS / Android simulator
```

The iOS binary can also be run natively on the Mac — no Catalyst, no second
codebase, and the same bundle identifier as the phone, which is what would let
the two share a pairing. It is **not** the macOS surface (that is `desktop/`'s
Tauri bundle, above) and it is part of no deploy. It builds:

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
