# AcctMind

Feel free to deploy this on your own website, build and deploy the iOS version, etc.

**This is a personal project to have some fun with claude code, which generated essentially all of the code, and the rest of this readme:**

A ledger. One list of transactions on every screen Sean owns: web, iOS,
Android, macOS and Windows. Two tabs, a two-level budget (categories, and the
lines under them with Budgeted, Spent and Available) and the transactions
grouped by account, with an Add button between them. Every rule the product
has is written once in TypeScript (`packages/core`) and every surface renders
it.

There is no API and no database. The device holds the ledger, and sync is
optional: iPhone and iPad pair over the local network, and iPhone and Mac
share one file in iCloud Drive. Windows, Android and web do not sync. Only the
web build asks who you are, because only the web build is on the open
internet; it reuses the suite's CalMind accounts and stores no password of its
own.

## Running it

```sh
npm install        # once, at the root
npm run web        # Expo web on :8083
npm run test:dev   # the between-runs suite: under a minute, no browser
npm test           # everything
```

## Deploying

```sh
cp deploy.conf.sample deploy.conf   # once: set SSH_DEST and SITE_URL
./deploy.sh                         # the sandbox AND production, sandbox first
```

`--test-only`, `--prod-only` and `--dry-run` narrow it. `npm run dtp` is the
release lane (deploy, preflight, tag, push) and `npm run tdtp` runs the full
tests first. Pushing the bare version tag makes GitHub build the Windows `.msi`
and `.exe` and the Apple-silicon `.dmg` and publish them, with checksums, as
one GitHub release. There is no Linux build and nothing for Intel Macs, and
the installers are unsigned. [ARCHITECTURE.md](ARCHITECTURE.md#releases) has
the whole lane, preflight included.

## More

[ARCHITECTURE.md](ARCHITECTURE.md) is the map: what every screen does, where
the data lives, how sync works, how each of the five platforms is built, and
why each of those is the way it is. [TESTING.md](TESTING.md) is what the tests
are worth, and [AGENTS.md](AGENTS.md) is how to work in here.

## License

BSD 3-Clause; see [LICENSE](LICENSE). Use it, change it, fold it into
something else, commercially or not; keep the copyright notice with the
source and don't use Sean's name to endorse what you build.
