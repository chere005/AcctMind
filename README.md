# AcctMind

Feel free to deploy this on your own website, build and deploy the iOS version, etc.

**This is a personal project to have some fun with claude code, which generated essentially all of the code, and the rest of this readme:**

A ledger. One list of transactions, on every screen Sean owns — web, iOS,
Android, macOS and Windows. Two tabs: transactions grouped by account, and a
two-level budget. Every rule the product has is written once, in TypeScript
(`packages/core`), and every surface renders it.

There is no API and no database. The device holds the ledger, and sync is
optional: iPhone and iPad pair over the local network, and iPhone and Mac
share one file in iCloud Drive. Windows, Android and web do not sync. Only
the web build asks who you are, because only the web build is on the open
internet; it reuses the suite's own sign-in.

## Running it

```sh
npm install        # once, at the root
npm run web        # Expo web on :8083
npm run test:dev   # the between-runs suite — under a minute, no browser
```

## Deploying

```sh
cp deploy.conf.sample deploy.conf   # once: set SSH_DEST and SITE_URL
./deploy.sh                         # the sandbox AND production, sandbox first
```

## Releases

Pushing a version tag releases the desktop apps. The tag is bare (`0.56.0`, no `v`) and
`.github/workflows/release.yml` does the rest on GitHub's own runners:

1. checks that the tag equals the version in every file that carries it (the six
   `tools/check-version.mjs` holds together) and that the release is not already
   published, then opens a **draft** GitHub release named `AcctMind <version>`, with
   the tag's annotation as its notes;
2. builds on Windows (typecheck, core suite, web export, Tauri build, and an
   install-and-launch smoke of the `.msi`) and on macOS (Apple silicon), attaching
   each build's files to that draft;
3. when every expected file is on the draft, writes `SHA256SUMS.txt` and publishes
   the release (Latest; a version with a `-` is a pre-release). If a file is missing,
   the release stays a draft.

The assets, for version `X`:

| Platform | File |
| --- | --- |
| Windows (x64) | `AcctMind_X_x64_en-US.msi`, `AcctMind_X_x64-setup.exe` |
| macOS (Apple silicon) | `AcctMind_X_aarch64.dmg` |
| All | `SHA256SUMS.txt` |

There is no Linux build and nothing for Intel Macs.

**Cutting one.** `npm run dtp` (or `npm run tdtp`, with the full test run in front)
bumps the version, deploys, runs the preflight, tags, pushes, then finds the Release
run the tag started, watches it, and prints its URL and the published release's. If
that run fails after the tag, the deploy stands: the lane says so, prints
`gh run rerun <id> --failed`, and exits non-zero.

**Releasing a tag that already exists** (the first release of a past version, or a
retry once a fix is on the tag's commit):

```sh
gh workflow run release.yml -f tag=0.55.0
```

**Preflight.** `sh tools/preflight.sh` runs the same jobs against HEAD before it is
tagged: it pushes HEAD to a throwaway `preflight/<sha>` branch, starts the workflow
there with `preflight=true`, prints PASS or the failing jobs and steps, and deletes the
branch. In preflight mode every job has `continue-on-error`, so a red job does not make
the run red (GitHub mails failed runs), and nothing is created, uploaded or published.
The lane does this before every tag; `--skip-preflight` leaves it out. The workflow
must already be on the default branch to be started by name.

**Why no build artifacts.** The workflow never uses `actions/upload-artifact`: this
account's Actions artifact storage quota is full, and every run that tried to upload
one failed. Release assets do not count against it, so each build uploads straight to
the release with `gh release upload`.

**Installing.** The builds are not code-signed. On first run Windows SmartScreen says
"Windows protected your PC": choose *More info*, then *Run anyway*. macOS Gatekeeper
stops an app that is not notarized: right-click it and choose *Open*, or use System
Settings > Privacy & Security > *Open Anyway*.

## More

**[ARCHITECTURE.md](ARCHITECTURE.md)** is the map: what every screen does, where
the data lives, how sync works, how each of the five platforms is built, and
why each of those is the way it is. [TESTING.md](TESTING.md) is what the tests
are worth, and [AGENTS.md](AGENTS.md) is how to work in here.

## License

BSD 3-Clause — see [LICENSE](LICENSE). Use it, change it, fold it into
something else, commercially or not; keep the copyright notice with the
source and don't use Sean's name to endorse what you build.
