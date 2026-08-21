/**
 * Two devices finding each other on a wifi network, and the code a person
 * types once to say that they are both his.
 *
 * The transport is Bonjour — `NWListener` advertising, `NWBrowser` looking,
 * a TLS connection carrying whole serialized stores back and forth. All of
 * that is Apple API and lives in the native module. What lives HERE is the
 * part that has to be identical on both ends and is worth a test: the
 * alphabet of the pairing code, its checksum, and the size beyond which a
 * frame is refused rather than allocated.
 *
 * WHAT THE PAIRING CODE IS. It is not a password chosen by a person; it is
 * 120 bits from the system CSPRNG, written in a way a person can retype. It
 * becomes the pre-shared key for TLS, so its entropy is the entire security
 * of the link, and that is why it is long. A short code would be typeable
 * and would also be recoverable OFFLINE by anyone who recorded one handshake
 * off the wifi — TLS-PSK authenticates with an HMAC over the transcript, so
 * a six-character secret is a six-character secret to an attacker with a
 * GPU. Twenty-five characters is a nuisance exactly once per pair of
 * devices, and it closes that attack permanently rather than narrowing it.
 *
 * WHAT THE ALPHABET IS FOR. Crockford's base32 — the digits and the letters
 * minus I, L, O and U. Nothing in a code can be confused for anything else
 * in it, and the three characters people substitute anyway are accepted and
 * folded on input: O reads as 0, I and L read as 1. The last character is a
 * Luhn mod 32 check, so a typo is caught while the person is still looking
 * at the keyboard rather than surfacing later as a connection that will not
 * open for no visible reason.
 *
 * WHAT IS NOT HERE: the exchange itself. Two peers swapping stores is the
 * same problem as a device meeting iCloud — what to hold, what to save, what
 * to send back — and `planSync` in `./sync` already answers it, including
 * the rule that stops the ping-pong. It is used unchanged, and
 * `test/peer.test.ts` pins that usage separately so that a change made for
 * iCloud's sake cannot quietly alter what happens over a socket.
 */

/**
 * The Bonjour service type both ends advertise and browse for.
 *
 * The `1` is a PROTOCOL version and is deliberately not the store version:
 * the two change for different reasons. A build that framed bytes
 * differently would advertise `_acctmind2._tcp` and simply never see the old
 * one, which is the correct outcome — better than two incompatible builds
 * connecting and failing halfway through a handshake.
 */
export const PEER_SERVICE = '_acctmind1._tcp';

/**
 * The largest frame either end will accept, in bytes.
 *
 * A length-prefixed protocol on an open network is an invitation to be told
 * "the next four gigabytes are a transaction list". The reader checks this
 * BEFORE it allocates. Four megabytes is roughly thirty thousand
 * transactions — far past anything this ledger will hold, and far short of
 * anything that hurts a phone.
 */
export const PEER_MAX_BYTES = 4 * 1024 * 1024;

/** Crockford base32: no I, no L, no O, no U. */
export const PAIR_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 15 bytes — 120 bits, which is exactly 24 characters with nothing over. */
export const PAIR_SECRET_BYTES = 15;

/** The data half of a code. The 25th character is the check. */
export const PAIR_DATA_CHARS = 24;

/** Characters between the dashes, for reading it off a screen. */
export const PAIR_GROUP = 5;

/** What a typed code turns into, or why it did not. */
export type PairParse =
  | { ok: true; secretHex: string }
  | { ok: false; error: string };

/**
 * The three substitutions people actually make, folded rather than rejected.
 *
 * U is absent on purpose: it is not in the alphabet and it is not a
 * plausible misreading of anything in it, so a U is a real mistake and says
 * so. Crockford leaves it out to avoid spelling accidents.
 */
const CONFUSIONS: Readonly<Record<string, string>> = { O: '0', I: '1', L: '1' };

/**
 * Render a secret as the code a person retypes.
 *
 * Takes hex rather than bytes because the random itself comes from the
 * platform — `SecRandomCopyBytes` on Apple — and hex is what crosses the
 * bridge. Core stays free of any opinion about where entropy comes from,
 * which is also what keeps this function testable with a fixed input.
 */
export function formatPairCode(secretHex: string): string {
  const bytes = hexToBytes(secretHex);
  if (bytes === null || bytes.length !== PAIR_SECRET_BYTES) {
    throw new Error(`a pairing secret is ${PAIR_SECRET_BYTES} bytes of hex`);
  }
  const data = toFiveBits(bytes);
  const chars = [...data, luhnCheck(data)].map((v) => PAIR_ALPHABET.charAt(v)).join('');
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += PAIR_GROUP) {
    parts.push(chars.slice(i, i + PAIR_GROUP));
  }
  return parts.join('-');
}

/**
 * Read a code back, however it was typed.
 *
 * Case, spaces and dashes are all noise and are discarded, so a code read
 * aloud, pasted with a trailing newline, or typed in lower case all arrive
 * at the same secret. The errors are written to be shown to a person: the
 * point of the checksum is that "that code has a typo in it" can be said
 * immediately, instead of a correct-looking code failing to connect and
 * leaving nothing to look at.
 */
export function parsePairCode(input: string): PairParse {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '');
  if (cleaned === '') return { ok: false, error: 'Enter the code shown on your other device.' };

  const values: number[] = [];
  for (const raw of cleaned) {
    const v = PAIR_ALPHABET.indexOf(CONFUSIONS[raw] ?? raw);
    if (v < 0) return { ok: false, error: `"${raw}" is not part of a pairing code.` };
    values.push(v);
  }

  if (values.length !== PAIR_DATA_CHARS + 1) {
    return {
      ok: false,
      error: `A pairing code is ${PAIR_DATA_CHARS + 1} characters; this one is ${values.length}.`,
    };
  }

  const data = values.slice(0, PAIR_DATA_CHARS);
  if (luhnCheck(data) !== values[PAIR_DATA_CHARS]) {
    return { ok: false, error: 'That code has a typo in it.' };
  }

  return { ok: true, secretHex: toHex(fromFiveBits(data)) };
}

/**
 * Luhn mod 32 — the check character.
 *
 * The published algorithm, not one invented here, because what it catches is
 * the thing that matters: EVERY single-character mistake, and adjacent
 * transpositions. A plain sum would catch the first and miss the second, and
 * swapping two characters while retyping is exactly what people do.
 */
function luhnCheck(values: readonly number[]): number {
  const n = PAIR_ALPHABET.length;
  let factor = 2;
  let sum = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const addend = factor * (values[i] ?? 0);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / n) + (addend % n);
  }
  return (n - (sum % n)) % n;
}

/** Bytes to 5-bit symbols. 120 bits divides by 5, so nothing is left over. */
function toFiveBits(bytes: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >> bits) & 31);
    }
  }
  return out;
}

/** And back. */
function fromFiveBits(values: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return out;
}

function hexToBytes(hex: string): number[] | null {
  if (hex.length % 2 !== 0) return null;
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    const pair = hex.slice(i, i + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) return null;
    out.push(parseInt(pair, 16));
  }
  return out;
}

function toHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
