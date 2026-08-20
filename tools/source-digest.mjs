/**
 * A stable fingerprint of the source the web export is built FROM.
 *
 * Written into `dist/build.json` by the export and re-computed by the e2e
 * suite before it runs. If they disagree, the dist is stale and the suite
 * refuses rather than reporting on code nobody is looking at — a green run
 * against last week's bundle is worse than no run, because it is believed.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Everything that ends up in the bundle. Order-stable, so the hash is too. */
export const SOURCES = ['packages/core/src', 'apps/app/src', 'apps/app/App.tsx', 'apps/app/index.ts'];

export function sourceDigest(root = process.cwd()) {
  const h = createHash('sha256');
  for (const entry of SOURCES) {
    for (const f of walk(join(root, entry))) {
      h.update(f.slice(root.length)).update(readFileSync(f));
    }
  }
  return h.digest('hex').slice(0, 16);
}

function walk(p) {
  if (!statSync(p).isDirectory()) return [p];
  const out = [];
  for (const name of readdirSync(p).sort()) out.push(...walk(join(p, name)));
  return out;
}
