/**
 * One version, in three files and on the tag.
 *
 * `app.config.js` carries the version a phone shows in Settings and the App
 * Store reads at upload. It sat at 0.1.0 through three tagged releases,
 * because nothing compared it to anything: the tags moved, the binary did
 * not, and a build installed on a device claimed to be days older than it
 * was. That is the kind of wrong that is only found when someone is trying
 * to work out which build they are looking at — which is exactly when they
 * need it to be right.
 *
 * The git tag is checked too, but only WARNED about: tags are created after
 * the commit that bumps the version, so a repo mid-release is legitimately
 * one behind and failing there would just teach people to skip the check.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = require('../package.json').version;
const app = require('../apps/app/package.json').version;
const config = require('../apps/app/app.config.js').expo.version;

let failed = 0;
const check = (what, ok, detail = '') => {
  console.log(ok ? `  ok   ${what}` : `  FAIL ${what}${detail ? `\n       ${detail}` : ''}`);
  if (!ok) failed++;
};

check(`the root package is ${root}`, typeof root === 'string' && root !== '');
check("apps/app/package.json agrees", app === root, `it says ${app}`);
check("app.config.js agrees — this is the one a device shows", config === root, `it says ${config}`);

let tag = null;
try {
  tag = execSync('git tag -l --sort=-v:refname', { encoding: 'utf8' }).split('\n')[0]?.trim() || null;
} catch { /* not a git checkout, or no tags yet */ }
if (tag !== null && tag !== root) {
  console.log(`  note  the newest tag is ${tag}, the version is ${root} — expected while a release is in flight`);
}

console.log('');
console.log(failed === 0 ? 'one version everywhere' : `${failed} disagreement(s)`);
process.exit(failed === 0 ? 0 : 1);
