/**
 * Make package-lock.json agree with the workspace package.json files.
 *
 * WHY THE RELEASE LANE RUNS THIS. A dtp bumps the version in package.json (and
 * the workspaces'), and npm mirrors those numbers inside the lock — top-level
 * `version`, `packages[""].version`, and one per workspace. Leave them behind
 * and the lock is a file that disagrees with the tree until the next
 * `npm install` silently rewrites it; the dtp after THAT then refuses to run,
 * reporting "uncommitted tracked changes" about a file nobody edited.
 *
 * It reads each version from the package.json it belongs to rather than
 * substituting an old string for a new one, so a lock that has already drifted
 * is corrected rather than merely kept from drifting further.
 *
 * Nothing else in the lock is touched: no resolution, no integrity, no
 * network. The caller checks the diff.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const lockPath = 'package-lock.json';
if (!existsSync(lockPath)) {
  console.log('  no package-lock.json — nothing to sync');
  process.exit(0);
}
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const changes = [];

const set = (obj, key, want, label) => {
  if (obj && typeof obj[key] === 'string' && obj[key] !== want) {
    changes.push(`${label}: ${obj[key]} -> ${want}`);
    obj[key] = want;
  }
};

const pkgVersion = (dir) => {
  const p = dir === '' ? 'package.json' : `${dir}/package.json`;
  if (!existsSync(p)) return null;
  const v = JSON.parse(readFileSync(p, 'utf8')).version;
  return typeof v === 'string' ? v : null;
};

for (const dir of Object.keys(lock.packages ?? {})) {
  // node_modules/* entries are dependencies, not this repo's workspaces.
  if (dir.startsWith('node_modules/')) continue;
  const want = pkgVersion(dir);
  if (want === null) continue;
  set(lock.packages[dir], 'version', want, `packages["${dir}"]`);
  if (dir === '') set(lock, 'version', want, 'version');
}

if (changes.length === 0) {
  console.log('  package-lock.json already agrees');
  process.exit(0);
}
// Two-space indent and a trailing newline: npm's own formatting, so the diff
// is the version lines and nothing else.
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
for (const c of changes) console.log(`  ${c}`);
