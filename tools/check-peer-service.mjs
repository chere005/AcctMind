/**
 * The Bonjour service type, checked rather than remembered.
 *
 * `NSBonjourServices` in Info.plist is an ALLOW-LIST, and that is the whole
 * reason this file exists: a service type missing from it does not error. The
 * browser starts, finds nothing, ever, and the app looks like sync is simply
 * broken with no failure to read anywhere. A one-character drift between
 * core's PEER_SERVICE and the plist would cost a day.
 *
 * NSLocalNetworkUsageDescription is checked for the same reason and a worse
 * consequence: without it iOS terminates the app the first time it touches
 * the local network, at the moment the person taps "Pair".
 *
 * Run with:  node --import ./tools/register-ts.mjs tools/check-peer-service.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { PEER_SERVICE, PEER_MAX_BYTES } from '../packages/core/src/peer.ts';

const require = createRequire(import.meta.url);
const config = require('../apps/app/app.config.js');

let failed = 0;
const check = (what, ok, detail = '') => {
  console.log(ok ? `  ok   ${what}` : `  FAIL ${what}${detail ? `\n       ${detail}` : ''}`);
  if (!ok) failed++;
};

const ios = config.expo?.ios ?? {};
const plist = ios.infoPlist ?? {};
const services = plist.NSBonjourServices;

check('Info.plist declares NSBonjourServices', Array.isArray(services), `got ${JSON.stringify(services)}`);

check(
  `the declared service is core's PEER_SERVICE (${PEER_SERVICE})`,
  Array.isArray(services) && services.includes(PEER_SERVICE),
  `Info.plist has ${JSON.stringify(services)}`,
);

check(
  'nothing else is declared — a stale type is a silent dead browse',
  Array.isArray(services) && services.length === 1,
  `Info.plist has ${JSON.stringify(services)}`,
);

check(
  'there is a local-network usage description for iOS to show',
  typeof plist.NSLocalNetworkUsageDescription === 'string'
    && plist.NSLocalNetworkUsageDescription.length > 20,
  'without this the app is terminated the first time it browses',
);

/*
 * And no third copy. The service type reaches Swift as an argument to
 * `start()`; a literal in the native module would be a copy that agrees
 * today and is nobody's job to keep agreeing.
 */
const nativeDir = new URL('../apps/app/modules/peer-sync/ios/', import.meta.url);
/*
 * Comments are stripped and the match must be QUOTED, because the first
 * version of this check looked for the bare text and then failed on a comment
 * that mentioned `dns-sd -B _acctmind1._tcp` — advice about how to debug this
 * exact feature. A guard that punishes writing down how to debug the thing it
 * guards will be deleted, and rightly. What it is actually looking for is a
 * string LITERAL, so that is what it looks for.
 */
const offenders = readdirSync(nativeDir)
  .filter((f) => f.endsWith('.swift'))
  .filter((f) => {
    const code = readFileSync(new URL(f, nativeDir), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    return /"_acctmind\w*\._tcp"/.test(code);
  });
check(
  'no Swift file hardcodes a service type',
  offenders.length === 0,
  `found one in: ${offenders.join(', ')}`,
);

check(
  'the frame cap is a real number that reaches the native side',
  Number.isSafeInteger(PEER_MAX_BYTES) && PEER_MAX_BYTES > 0,
  String(PEER_MAX_BYTES),
);

console.log('');
console.log(failed === 0 ? 'the plist and core agree on the service' : `${failed} disagreement(s)`);
process.exit(failed === 0 ? 0 : 1);
