/**
 * The placeholder app icon, generated rather than committed.
 *
 * A binary nobody can regenerate is a binary nobody can change. This writes
 * a 1024×1024 source PNG with no dependencies (zlib and a CRC table are all
 * a PNG needs), which `npx @tauri-apps/cli icon` then fans out into the
 * .icns/.ico/png set the bundles want.
 *
 *   node tools/make-icon.mjs && npx @tauri-apps/cli icon assets/icon.png -o desktop/src-tauri/icons
 *
 * It is a placeholder and looks like one on purpose: a ledger rule on the
 * app's own background. Replace `assets/icon.png` with something real and
 * re-run the second command.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/** Lazily built CRC table. Declared up here: `let` below first use is a
 *  temporal-dead-zone error, not a hoisted `var`. */
let TABLE = null;

const N = 1024;
const BG = [0x11, 0x11, 0x11];
const ACCENT = [0x0a, 0x84, 0xff];
const INK = [0xf2, 0xf2, 0xf7];

const px = Buffer.alloc(N * N * 3);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let c = BG;
    // A rounded accent field, inset — the app's own square.
    if (inRounded(x, y, 96, N - 96, 200)) c = ACCENT;
    // Three ledger rules across it, the middle one short: a list with a total.
    for (const [ry, from, to] of [[400, 240, 784], [520, 240, 784], [640, 240, 620]]) {
      if (y >= ry && y < ry + 48 && x >= from && x < to) c = INK;
    }
    const i = (y * N + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  }
}

/** Inside a rounded square from `a` to `b` with corner radius `r`. */
function inRounded(x, y, a, b, r) {
  if (x < a || x >= b || y < a || y >= b) return false;
  const cx = Math.min(Math.max(x, a + r), b - r);
  const cy = Math.min(Math.max(y, a + r), b - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// --- PNG: signature, IHDR, IDAT, IEND -------------------------------------
const raw = Buffer.alloc(N * (N * 3 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 3 + 1)] = 0;                                  // filter: none
  px.copy(raw, y * (N * 3 + 1) + 1, y * N * 3, (y + 1) * N * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 2;                                    // 8-bit, truecolour

mkdirSync('assets', { recursive: true });
writeFileSync('assets/icon.png', Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log('wrote assets/icon.png (1024x1024)');

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  if (TABLE === null) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
