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
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const root = require('../package.json').version;
const app = require('../apps/app/package.json').version;
const config = require('../apps/app/app.config.js').expo.version;

let failed = 0;
const check = (what, ok, detail = '') => {
  console.log(ok ? `  ok   ${what}` : `  FAIL ${what}${detail ? `\n       ${detail}` : ''}`);
  if (!ok) failed++;
};

/*
 * The build number, which answers a different question from the version.
 *
 * Hand-bumped per BUILD, so it is not compared to anything — there is nothing
 * to compare it to. What is checked is that it exists and has moved off 1: a
 * build number that never changes is the same as not having one, which is the
 * state this repo shipped in while four different builds all reported `1`.
 */
const build = require('../apps/app/app.config.js').expo.ios?.buildNumber;
check(
  'there is an ios.buildNumber',
  typeof build === 'string' && build !== '',
  'without one every install reads 1 and builds cannot be told apart',
);

check(`the root package is ${root}`, typeof root === 'string' && root !== '');
check("apps/app/package.json agrees", app === root, `it says ${app}`);
check("app.config.js agrees — this is the one a device shows", config === root, `it says ${config}`);

/*
 * And the Mac app, which is a separate bundle carrying its own version.
 *
 * `desktop/src-tauri/tauri.conf.json` is what macOS shows in About and in
 * Finder's Get Info. It sat at 0.1.0 while the phone shipped 0.5.1 — through
 * five releases — because this check compared the three PHONE files to each
 * other and never looked at the Mac. That is worse than carrying no version:
 * it answers "which build am I looking at?" confidently and wrongly, which is
 * the exact failure the buildNumber rule above exists to prevent.
 *
 * Cargo.toml is checked too. Tauri v2 takes the bundle version from the JSON,
 * so the crate version is not what ships — but a crate that disagrees with
 * the bundle it builds is a trap for the next person reading either file.
 */
const tauri = JSON.parse(
  readFileSync(new URL('../desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
).version;
check('the Mac bundle agrees — this is the one About shows', tauri === root, `it says ${tauri}`);

const desktopPkg = require('../desktop/package.json').version;
check('desktop/package.json agrees', desktopPkg === root, `it says ${desktopPkg}`);

const cargo = /^version = "([^"]*)"/m.exec(
  readFileSync(new URL('../desktop/src-tauri/Cargo.toml', import.meta.url), 'utf8'),
)?.[1] ?? null;
check('the desktop crate agrees', cargo === root, `it says ${cargo}`);

/*
 * And the GENERATED plist, which is the one that actually ships.
 *
 * `app.config.js` is source; `apps/app/ios/` is `expo prebuild` output, and
 * xcodebuild reads the baked Info.plist. Bumping the config and building
 * without prebuilding installs a binary carrying the OLD number — which is
 * exactly what happened, and what the first version of this check missed,
 * because it compared three source files to each other and none of them to
 * the thing on the phone.
 *
 * Absent is fine: `ios/` is disposable prebuild output and is not always
 * present. Present and WRONG is not.
 */
const plist = new URL('../apps/app/ios/AcctMind/Info.plist', import.meta.url);
if (existsSync(plist)) {
  const xml = readFileSync(plist, 'utf8');
  const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(xml);
  const built = m?.[1] ?? null;
  check(
    'the generated Info.plist agrees — run `expo prebuild` if it does not',
    built === root,
    `apps/app/ios says ${built}; a build from here would ship that, not ${root}`,
  );

  /*
   * And the BUILD NUMBER in that plist, which was invisible until it wasn't.
   *
   * A `sed` meant to set the build number to 1 silently matched nothing, the
   * config kept a different value, the app built and installed carrying it —
   * and this check said "one version everywhere", because it compared the
   * VERSION to the plist and never the build number. The one field whose
   * entire job is telling two builds apart was the one field nothing checked.
   */
  const plistBuild = /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(xml)?.[1] ?? null;
  check(
    'the generated Info.plist has the buildNumber from app.config.js',
    plistBuild === build,
    `apps/app/ios says ${plistBuild}; app.config.js says ${String(build)} — run \`expo prebuild\``,
  );
}

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
