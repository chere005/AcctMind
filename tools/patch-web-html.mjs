/**
 * The head Expo's web export doesn't give us, plus a stamp saying what this
 * export IS.
 *
 * `expo export -p web` writes a fixed index.html and offers no documented
 * hook for extra <head> tags on a non-Expo-Router app. So the export is
 * patched here — idempotently, so running it twice is a no-op and a future
 * Expo that emits these itself will not double up.
 *
 * Never call `expo export` directly; call `npm run export:web`, which is the
 * export PLUS this. A bare export ships an index.html that renders a white
 * strip above a dark app on an iPhone, and carries no build stamp.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceDigest } from './source-digest.mjs';

const dist = process.argv[2] ?? 'apps/app/dist';
const file = join(dist, 'index.html');
let html = readFileSync(file, 'utf8');

// ---------------------------------------------------------------- the head
//
//  · viewport-fit=cover — WITHOUT it, env(safe-area-inset-*) is 0 on iOS, so
//    react-native-safe-area-context reports no inset, the app never pads for
//    the notch, and iOS draws its OWN opaque status bar over the top. That
//    bar is light by default: a white strip above a dark app.
//  · apple-mobile-web-app-status-bar-style=black-translucent — makes that bar
//    transparent so the app's own background shows through the inset.
//  · *-web-app-capable — standalone, so a home-screen launch has no chrome.
//  · theme-color — the browser UI colour around the app.
html = html.replace(/(<meta\s+name="viewport"\s+content=")([^"]*)(")/i, (m, a, content, z) =>
  /viewport-fit/.test(content) ? m : `${a}${content}, viewport-fit=cover${z}`);

const metas = [
  ['apple-mobile-web-app-capable', 'yes'],
  ['mobile-web-app-capable', 'yes'],
  ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
  ['theme-color', '#111111'],
];
const add = metas
  .filter(([name]) => !new RegExp(`<meta[^>]+name=["']${name}["']`, 'i').test(html))
  .map(([name, content]) => `<meta name="${name}" content="${content}"/>`)
  .join('');
if (add) html = html.replace('</head>', `${add}</head>`);

if (/<title>.*?<\/title>/i.test(html)) html = html.replace(/<title>.*?<\/title>/i, '<title>AcctMind</title>');
else html = html.replace('</head>', '<title>AcctMind</title></head>');

/**
 * An uncaught error you can SEE, on a device with no console.
 *
 * A blank dark screen is what a failed render looks like from outside, and
 * an installed home-screen web app has no console to attach. Inline and
 * FIRST, so it is listening before the bundle runs. It draws nothing unless
 * something throws.
 *
 * The capture phase, and resource failures named separately: a <script> that
 * 404s does not bubble an error to `window` and carries no message — which
 * is exactly what a bundle deployed under the wrong base URL looks like.
 */
const TRAP = `<script>(function(){function show(m){try{var d=document.getElementById('acct-fatal')||document.createElement('div');d.id='acct-fatal';d.setAttribute('data-testid','fatal');d.style.cssText='position:fixed;inset:0;z-index:99999;background:#111;color:#f2f2f7;font:13px/1.5 -apple-system,system-ui,sans-serif;padding:24px;white-space:pre-wrap;overflow:auto';d.textContent='AcctMind could not start.\\n\\n'+m;if(!d.parentNode)document.body.appendChild(d)}catch(e){}}
window.addEventListener('error',function(e){if(e.target&&e.target!==window&&e.target.src){show('Failed to load: '+e.target.src+'\\n\\nIf that path looks like the wrong instance, this export was built for a different base URL.')}else{show(e.message||String(e.error))}},true);
window.addEventListener('unhandledrejection',function(e){show('Unhandled promise rejection: '+((e.reason&&e.reason.message)||String(e.reason)))});})();</script>`;
if (!html.includes("id='acct-fatal'") && !html.includes('acct-fatal')) {
  html = html.replace(/<head([^>]*)>/i, (m) => m + TRAP);
}

writeFileSync(file, html);

// --------------------------------------------------------------- the stamp
//
// What instance this export is for, and what source it came from. The
// deploy reads `baseUrl` to refuse sending an export to the wrong path — the
// failure that would otherwise have the sandbox quietly running production's
// bundle — and the e2e suite reads `digest` to refuse running against a
// stale dist rather than reporting on code nobody is looking at.
const stamp = {
  baseUrl: process.env.ACCTMIND_BASE_URL || '/AcctMind',
  built: new Date().toISOString(),
  digest: sourceDigest(),
};
writeFileSync(join(dist, 'build.json'), JSON.stringify(stamp, null, 2) + '\n');
console.log(`patched ${file} — base ${stamp.baseUrl}, source ${stamp.digest}`);
