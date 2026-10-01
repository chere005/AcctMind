/**
 * Refuse to run against a stale export.
 *
 * A gesture suite is only worth what the bundle under it is worth. A green
 * run against last week's `dist` is worse than no run at all, because it is
 * believed. This compares the digest the export stamped into
 * `dist/build.json` against the source on disk right now, and names the
 * files that moved.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

export function assertFresh(root: string): void {
  let stamp: { digest?: string; baseUrl?: string; built?: string };
  try {
    stamp = JSON.parse(readFileSync(`${root}/apps/app/dist/build.json`, 'utf8')) as typeof stamp;
  } catch {
    throw new Error('no dist/build.json — run `npm run export:web` first.');
  }

  const now = execSync(
    `node -e "import('./tools/source-digest.mjs').then(m => process.stdout.write(m.sourceDigest()))"`,
    { cwd: root },
  ).toString();

  if (stamp.digest !== now) {
    throw new Error(
      `the export is stale: dist was built from ${stamp.digest}, the source is now ${now}.\n`
      + `Run \`npm run export:web\` (which is the export PLUS the head patch — never a bare \`expo export\`).`,
    );
  }

  // THE LANE'S RECEIPT. tdtp carries this suite's verdict to deploy.sh by the
  // tools/dist-key.mjs key of what it ran on, and it can only key that AFTER
  // npm test — so an export or a spec edited while the suite was running would
  // be keyed as passed when the suite drove the bytes from before. When the
  // lane asks (ACCTMIND_GESTURES_SEEN names a file), every process that loads
  // this config appends the key it STARTS on, and tools/dtp.sh carries the
  // verdict only if every one of them equals the key at the end. Unset —
  // every run but tdtp's — this does nothing. A receipt that cannot be
  // written only means nothing is carried; it never fails the suite.
  const receipt = process.env.ACCTMIND_GESTURES_SEEN;
  if (receipt) {
    try {
      const key = execSync('node tools/dist-key.mjs apps/app/dist', { cwd: root }).toString();
      appendFileSync(receipt, `${key}\n`);
    } catch { /* no receipt, so no verdict carried: deploy.sh runs the suite */ }
  }
}
