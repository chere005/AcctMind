/**
 * Money, in integer minor units.
 *
 * Every amount in AcctMind is an integer number of cents. Nothing here ever
 * produces a fractional value, and nothing outside here is allowed to do
 * arithmetic on a formatted string. This is the one rule the product cannot
 * bend: 0.1 + 0.2 is not 0.3 in a float, and a ledger that loses a cent to
 * that is worse than a ledger that refuses the input.
 */

/** The largest amount we will accept: $10,000,000,000. */
export const MAX_CENTS = 1_000_000_000_000;

/**
 * Parse what a person typed into integer cents. Returns null when the input
 * is not an amount — the caller decides what to say about it.
 *
 * Accepted: `12`, `12.5`, `12.50`, `$12.50`, `1,234.56`, `-5`, `+5`, and the
 * accounting parenthesis `(12.34)` for a negative.
 *
 * Rejected, deliberately: three or more decimal places. `1.005` could be
 * rounded to 100 or 101 cents and both are defensible, which is exactly why
 * this refuses to pick one silently. Refusing sends the person back to a
 * field they can see; rounding sends them a balance they cannot explain.
 */
export function parseAmount(input: string): number | null {
  let s = input.trim();
  if (s === '') return null;

  // Accounting parentheses mean negative, and may not be combined with a sign.
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  if (s.startsWith('$')) s = s.slice(1).trim();
  // Thousands separators are stripped without being validated for position:
  // `1,23,4.5` parses. Policing grouping would reject correct input from
  // anyone whose habits differ from US ones, and the value is unambiguous
  // either way.
  s = s.replaceAll(',', '');
  if (s === '') return null;

  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const whole = m[1] ?? '';
  const frac = m[2];
  // A bare '.' has neither side and is not a number.
  if (whole === '' && (frac === undefined || frac === '')) return null;
  if (frac !== undefined && frac.length > 2) return null;

  // Pad rather than multiply: '5' -> 50 cents, '50' -> 50 cents, '' -> 0.
  const cents = Number(whole === '' ? '0' : whole) * 100
    + Number((frac ?? '').padEnd(2, '0') || '0');

  // Past this the value stops being exactly representable, and an amount that
  // silently loses precision is the failure this whole module exists to
  // prevent. It is a refusal, not a clamp — a clamp would store a number the
  // person never typed.
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;

  // `negative && cents !== 0`, not just `negative`: negating zero gives -0,
  // which is not 0 under Object.is and turns back into 0 through JSON. An
  // amount that changes identity when it is saved and loaded is a bug that
  // only shows up as a failing equality somewhere far from here.
  return negative && cents !== 0 ? -cents : cents;
}

/**
 * Render cents for display: `-$1,234.56`.
 *
 * The grouping is hand-rolled rather than delegated to `toLocaleString`.
 * React Native runs on Hermes, whose ICU data is a build-time option — the
 * same call can group on the web, in a simulator, and not on a device, and
 * the difference shows up as a wrong-looking balance rather than an error.
 * Six surfaces have to agree on this string, so it is computed the same way
 * on all six.
 */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return (negative ? '-$' : '$') + group(whole) + '.' + String(frac).padStart(2, '0');
}

/** Cents as a plain editable string — what the amount field is seeded with. */
export function amountInput(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  return (negative ? '-' : '')
    + String(Math.trunc(abs / 100)) + '.' + String(abs % 100).padStart(2, '0');
}

/** Digits in threes from the RIGHT: 1234567 -> 1,234,567. */
function group(n: number): string {
  const s = String(n);
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return parts.join(',');
}
