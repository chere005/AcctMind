# AcctMind

Feel free to deploy this on your own website, build and deploy the iOS version, etc.

**This is a personal project to have some fun with claude code, which generated essentially all of the code, and the rest of this readme:**

A ledger: transactions by account, and a two-level budget.

- Runs on web, iOS, Android, macOS and Windows. One TypeScript core.
- No server, no database. The device holds the ledger.
- Optional sync: iPhone and iPad over the local network, iPhone and Mac via iCloud Drive.
- Only the web build signs in, with a CalMind account.

<table>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/acctmind-budget-mobile.png" width="240" alt="Budget"><br><sub><b>Budget.</b> Adjust an allocation and see its target, spent and remaining.</sub></td>
<td align="center" valign="top"><img src="docs/screenshots/acctmind-transactions-mobile.png" width="240" alt="Transactions"><br><sub><b>Transactions.</b> Income and expenses by account, with balances.</sub></td>
<td align="center" valign="top"><img src="docs/screenshots/acctmind-add-transaction-mobile.png" width="240" alt="Add a transaction"><br><sub><b>Add a transaction.</b> Name, date, category, description, amount.</sub></td>
</tr>
</table>

## Run

```sh
npm install
npm run web          # :8083
npm run test:dev
```

Deploy: copy `deploy.conf.sample` to `deploy.conf`, then `./deploy.sh`. Release: `npm run dtp` (or `tdtp`, tests first); the tag builds Windows and macOS installers on GitHub.

Docs: [ARCHITECTURE](ARCHITECTURE.md) · [TESTING](TESTING.md) · [AGENTS](AGENTS.md). BSD 3-Clause.
