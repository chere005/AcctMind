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

/* ------------------------------------------------------------------ *
 * Entering an amount
 *
 * `parseAmount` above reads a COMPLETE amount — a saved record, an import,
 * a pasted string. What follows is for the field a person types into, which
 * is a different problem: it has to make sense of a half-finished string on
 * every keystroke, and it has to be predictable enough that nobody has to
 * think about it while entering the third transaction in a row.
 *
 * The rule, and it is one rule with one exception:
 *
 *   **Digits fill up from the cents.** `5` is 5c, `50` is 50c, `1234` is
 *   $12.34 — the way a card terminal works, and the reason is that the
 *   overwhelming majority of amounts in a ledger have cents in them. Typing
 *   `4`,`5`,`0` for $4.50 costs three keystrokes and no punctuation.
 *
 *   **A typed `.` overrides it.** The moment there is a dot, the string is
 *   read the ordinary way: `12.34` is $12.34 and `50.` is $50.00. A trailing
 *   dot is not an error — it is how someone says "that was the whole part,
 *   I am done".
 *
 * `.00` mode flips the default for people entering round numbers all
 * afternoon: `50` becomes $50.00. A typed dot still wins, so the two never
 * contradict each other.
 *
 * The sign lives in the TEXT, as a leading `-`, and nowhere else. The − button
 * adds or removes that character. One source of truth means typing the minus
 * and tapping the button cannot disagree, which they would the moment the
 * sign became a second piece of state.
 * ------------------------------------------------------------------ */

/** How bare digits are read when no `.` has been typed. */
export type AmountMode = 'cents' | 'whole';

/** The most decimal places an amount can have. */
const FRAC_MAX = 2;

/**
 * Reduce a raw field value to what an amount FIELD may contain: digits, and
 * at most one dot.
 *
 * No sign. Sean, 2026-08-21: "don't show the - in the input field and only
 * allow numbers to be typed." The sign is held by the − button beside the
 * field and nowhere else, which is the reverse of the rule this replaced —
 * that one put the sign in the text so the minus KEY and the minus BUTTON
 * could not disagree. They cannot disagree now either, for the stronger
 * reason that there is only one of them. `signedCents` is where the two
 * sources are put back together.
 *
 * A minus is dropped exactly like a `$` or a comma. So is everything else:
 * `$`, spaces and grouping commas are noise a person may paste in, and a
 * field that refuses a pasted `$1,234.56` is a field that argues with its
 * user.
 *
 * A third decimal digit is KEPT, deliberately, even though no amount can have
 * one. Silently dropping it would turn a pasted `1.005` into `1.00` — a value
 * nobody typed — which is precisely the substitution `parseAmount` refuses to
 * make. So it stays in the field, `entryCents` returns null, and the person
 * is told. Refusing sends someone back to a field they can see; truncating
 * sends them a balance they cannot explain.
 */
export function amountDigits(raw: string): string {
  let out = '';
  let seenDot = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (ch === '.' && !seenDot) {
      seenDot = true;
      out += ch;
    }
  }
  return out;
}

/**
 * Does this composed string carry a sign? Internal to `entryCents` and to
 * `parseAmount`'s callers — a FIELD never holds a sign to read, which is why
 * nothing in a screen calls this any more.
 */
export function amountIsNegative(text: string): boolean {
  return text.startsWith('-');
}

/**
 * Read cleaned field text as integer cents, or null when it is not yet an
 * amount — empty, a lone `-`, a lone `.`.
 *
 * Null is not an error here. It is the ordinary state of a field someone has
 * begun typing into, and the caller shows nothing rather than a complaint.
 */
export function entryCents(text: string, mode: AmountMode): number | null {
  const negative = amountIsNegative(text);
  const body = negative ? text.slice(1) : text;
  if (body === '' || body === '.') return null;

  let cents: number;
  const dot = body.indexOf('.');
  if (dot >= 0) {
    // A dot was typed, so this is an ordinary amount and the mode does not
    // apply. `50.` is $50.00: the empty fraction pads, exactly as `50.0`
    // would.
    const whole = body.slice(0, dot);
    const frac = body.slice(dot + 1);
    // The same refusal as parseAmount: 1.005 could be 100 or 101 cents and
    // both are defensible, which is exactly why nothing here picks one.
    if (frac.length > FRAC_MAX) return null;
    cents = Number(whole === '' ? '0' : whole) * 100 + Number(frac.padEnd(FRAC_MAX, '0') || '0');
  } else if (mode === 'whole') {
    cents = Number(body) * 100;
  } else {
    // The default: the digits ARE the cents.
    cents = Number(body);
  }

  // Same refusal as parseAmount, for the same reason: past this the value is
  // not exactly representable, and an amount that quietly loses precision is
  // the failure this module exists to prevent.
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  // And the same -0 guard — see parseAmount.
  return negative && cents !== 0 ? -cents : cents;
}

/**
 * An amount from its two halves: the digits in the field, and the − button
 * beside it.
 *
 * The composition is here rather than in each screen because there are three
 * fields of this shape — the add form, the row's inline editor, and the
 * budget pad — and a screen that composes it itself is a screen that has
 * composed it wrong on five other surfaces. It is one line; being one line is
 * not a reason to write it three times.
 *
 * Zero is the case worth having a vector for: `-0` is not `0` under
 * `Object.is` and turns back into `0` through JSON, so an amount that changes
 * identity when it is saved would be a failing equality somewhere far from
 * here. `entryCents` already guards it, and this inherits that.
 */
export function signedCents(
  digits: string,
  negative: boolean,
  mode: AmountMode,
): number | null {
  return entryCents(negative ? `-${digits}` : digits, mode);
}
