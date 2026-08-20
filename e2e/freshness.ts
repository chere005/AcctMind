/**
 * Refuse to run against a stale export.
 *
 * A gesture suite is only worth what the bundle under it is worth. A green
 * run against last week's `dist` is worse than no run at all, because it is
 * believed. This compares the digest the export stamped into
 * `dist/build.json` against the source on disk right now, and names the
 * files that moved.
 */
import { readFileSync } from 'node:fs';
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
}
