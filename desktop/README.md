# AcctMind Desktop

A Tauri 2 shell around the identical web export. Rust opens a window;
everything inside it is the same JavaScript the website serves, and the same
`packages/core` every other surface uses. Two of the six surfaces —  macOS
and Windows — are this one directory.

```sh
npm run export:web          # first: the shell carries an export, it does not make one
cd desktop && npx tauri dev  # a window, with devtools
./desktop/smoke.sh          # build, prove it carries THIS export, launch, quit
sh desktop/check-assets.sh  # the same proofs without the 70-second Rust build
```

**No sign-in here.** The doorway gates the *web* app because the web app is
on the open internet. The desktop shell carries its own copy of the bundle
and reads a ledger that never leaves the machine, so there is nothing for a
password to protect.

**Windows** builds on the manual `desktop-windows` GitHub Actions job — Tauri
cannot cross-compile from a Mac. Same source, same export, a `.msi` and an
`.exe` at the end of it.

## The one bug this directory is shaped around

The web export is built for a base path (`/AcctMind`), and that path is baked
into the JS as well as the HTML. A shell that serves the export at the root of
`tauri://localhost/` therefore 404s its own bundle, Tauri answers the 404 with
index.html, and the parser meets a `<`. The window comes up empty.

`stage-dist.sh` is the fix — the export is staged UNDER the path it was built
for, so not one byte differs from what the site serves — and `check-assets.sh`
and `smoke.sh` are what stop it coming back. Read `stage-dist.sh`'s header
before changing any of the three.
