/**
 * A key for one verdict: "the full gesture suite passed on THESE bytes".
 *
 * WHY IT EXISTS. tdtp ran the full gesture suite twice: once in `npm test`,
 * before anything is touched, and again in deploy.sh's full gate, on a fresh
 * export of the same source — byte for byte the bundle the first run had just
 * passed (the bump moves no byte of the web export; `expo export` wipes dist
 * first, so nothing is left over). 365 tests, about two minutes, sampling the
 * same thing twice. tools/dtp.sh now keys the first run's verdict with this,
 * and deploy.sh repeats the suite only when ITS export, or anything that
 * decides what the suite does, keys differently.
 *
 * WHAT GOES IN — everything that could make the second run differ:
 *   · the export: every file in dist by sorted path and bytes, with
 *     build.json reduced to { baseUrl, digest }. Its `built` timestamp is the
 *     one field two exports of the same tree disagree on; the digest still
 *     covers every source file, packages/core/src included.
 *   · the harness: every file under e2e/, playwright.config.ts,
 *     tools/source-digest.mjs (what e2e/freshness.ts runs) and
 *     packages/core/package.json (how two specs resolve @acctmind/core).
 *   · the runner: the INSTALLED @playwright/test, playwright and
 *     playwright-core (what runs, not what a lock file asks for),
 *     playwright-core's browsers.json (which browser builds), and this node.
 *   · what the harness's own files read from the environment:
 *     ACCTMIND_BASE_URL as they resolve it, CI, PORT.
 *
 * Content only, never a time: a key that matches means the same bytes. A file
 * that cannot be read is an ERROR, never a shorter key — the callers treat a
 * failure here as "run the suite".
 *
 *   node tools/dist-key.mjs [dist]      from the repo root; prints the key
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const dist = join(root, process.argv[2] ?? 'apps/app/dist');
const h = createHash('sha256');

function walk(p) {
  if (!statSync(p).isDirectory()) return [p];
  const out = [];
  for (const name of readdirSync(p).sort()) out.push(...walk(join(p, name)));
  return out;
}
// Labelled and length-prefixed, so no two different inputs can concatenate
// to the same stream.
function add(label, name, bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  h.update(`${label}\0${name}\0${b.length}\0`).update(b);
}

// ------------------------------------------------------------------ the export
const files = walk(dist).map((f) => relative(dist, f)).sort();
if (!files.includes('build.json') || !files.includes('index.html')) {
  throw new Error(`${dist} holds no export (no build.json or index.html)`);
}
for (const f of files) {
  if (f === 'build.json') {
    const s = JSON.parse(readFileSync(join(dist, f), 'utf8'));
    if (typeof s.baseUrl !== 'string' || typeof s.digest !== 'string') {
      throw new Error(`${dist}/build.json names no baseUrl or digest`);
    }
    add('dist', f, JSON.stringify({ baseUrl: s.baseUrl, digest: s.digest }));
  } else {
    add('dist', f, readFileSync(join(dist, f)));
  }
}

// ----------------------------------------------------------------- the harness
for (const f of walk(join(root, 'e2e')).map((p) => relative(root, p)).sort()) {
  add('harness', f, readFileSync(join(root, f)));
}
for (const f of ['playwright.config.ts', 'tools/source-digest.mjs', 'packages/core/package.json']) {
  add('harness', f, readFileSync(join(root, f)));
}

// ------------------------------------------------------------------ the runner
for (const pkg of ['@playwright/test', 'playwright', 'playwright-core']) {
  const { version } = JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8'));
  if (!version) throw new Error(`node_modules/${pkg} carries no version`);
  add('runner', pkg, version);
}
add('runner', 'browsers.json', readFileSync(join(root, 'node_modules/playwright-core/browsers.json')));
add('runner', 'node', `${process.version} ${process.platform}-${process.arch}`);

// ----------------------------------------------------------------- the settings
// What playwright.config.ts (ACCTMIND_BASE_URL, CI) and e2e/serve.mjs
// (ACCTMIND_BASE_URL, PORT) read. NOT Playwright's own PLAYWRIGHT_* and PW_*:
// the runner sets some of those for its worker processes, so they differ
// between the processes of ONE run (measured: a receipt with two keys in it),
// and the lane takes every key it compares in one inherited environment.
const env = {
  ACCTMIND_BASE_URL: process.env.ACCTMIND_BASE_URL || '/AcctMind',
  CI: process.env.CI ?? null,
  PORT: process.env.PORT ?? null,
};
add('env', 'env', JSON.stringify(env));

process.stdout.write(h.digest('hex'));
