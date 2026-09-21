# AcctMind

Feel free to deploy this on your own website, build and deploy the iOS version, etc.

**This is a personal project to have some fun with claude code, which generated essentially all of the code, and the rest of this readme:**

A ledger. One list of transactions, on every screen Sean owns — web, iOS,
Android, macOS and Windows. Two tabs: transactions grouped by account, and a
two-level budget. Every rule the product has is written once, in TypeScript
(`packages/core`), and every surface renders it.

There is no API and no database. The device is the only copy, and the two
sync links are optional — every surface is a working app with both switched
off. Only the web build asks who you are, because only the web build is on
the open internet; it reuses the suite's own sign-in.

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

## More

**[ARCHITECTURE.md](ARCHITECTURE.md)** is the map: what every screen does, where
the data lives, how sync works, how each of the five platforms is built, and
why each of those is the way it is. [TESTING.md](TESTING.md) is what the tests
are worth, and [AGENTS.md](AGENTS.md) is how to work in here.

## License

BSD 3-Clause — see [LICENSE](LICENSE). Use it, change it, fold it into
something else, commercially or not; keep the copyright notice with the
source and don't use Sean's name to endorse what you build.
