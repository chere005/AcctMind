/**
 * The harness's web server: the real export, at the real path.
 *
 * Serving `dist` at `/` would pass while the deployed app was broken — the
 * whole point of `experiments.baseUrl` is that assets are requested at
 * `/AcctMind/_expo/...`, so a harness that serves them anywhere else is
 * testing a layout that does not exist on the server.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../apps/app/dist/', import.meta.url));
const BASE = process.env.ACCTMIND_BASE_URL || '/AcctMind';
const PORT = Number(process.env.PORT || 8791);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let path = decodeURIComponent(url.pathname);

  if (path === BASE) { res.writeHead(302, { Location: BASE + '/' }); return res.end(); }
  if (!path.startsWith(BASE + '/')) { res.writeHead(404); return res.end('outside the app'); }
  path = path.slice(BASE.length);

  // normalize() before joining: without it a '..' in the URL walks out of
  // dist and serves the repo.
  let file = join(ROOT, normalize(path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  if (path === '/' || (existsSync(file) && statSync(file).isDirectory())) file = join(ROOT, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`serving dist at http://127.0.0.1:${PORT}${BASE}/`));
