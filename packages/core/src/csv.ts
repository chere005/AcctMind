/**
 * Importing a bank's CSV export.
 *
 * All of it is here rather than in the import screen, for the reason every
 * rule is: five surfaces, and a parser written in a screen is a parser
 * written wrong four more times. The screen picks a file and shows a count;
 * every decision about what a line MEANS is in this file, with vectors in
 * `spec/csv.json`.
 *
 * Scope, stated plainly: this reads the Wells Fargo checking export, because
 * that is the file Sean has (2026-09-15, 1952 rows, 2024-08-16 onward). The
 * column reader is general — quoted fields, any column order, header matched
 * by name — and only `wellsFargoName` knows one bank's habits. A second bank
 * is a second name function and nothing else.
 */
import { parseAmount } from './money';
import { addDays, isDay } from './day';
import { newId, REORDER_GAP } from './txn';
import { tombstone, touch } from './merge';
import type { Store, Txn } from './types';

/* ------------------------------------------------------------------ *
 * Reading the file
 * ------------------------------------------------------------------ */

/**
 * Split CSV text into rows of fields.
 *
 * Hand-rolled because the format is small and a dependency here would have to
 * be bundled onto five surfaces. It handles what a bank actually emits:
 * quoted fields, commas and newlines inside quotes, `""` as an escaped quote,
 * and CRLF.
 *
 * A trailing newline does NOT produce a final empty row — that would be an
 * extra transaction with no date, which is exactly the kind of thing that
 * imports silently and is then hunted for.
 */
export function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  const endField = () => { row.push(field); field = ''; started = true; };
  const endRow = () => {
    endField();
    // A row that is a single empty field is a blank line, not a record.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; started = true; continue; }
    if (ch === ',') { endField(); continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { endRow(); continue; }
    field += ch;
  }
  if (field !== '' || row.length > 0 || started) endRow();
  return rows;
}

/** A line of the file, already understood. `amount` is integer cents. */
export type CsvRow = {
  /** `YYYY-MM-DD`, local, converted from the file's own format. */
  date: string;
  /** The bank's raw text, kept verbatim — it is the audit trail. */
  description: string;
  /** Integer minor units. Negative is money out, as everywhere else. */
  amount: number;
  /**
   * On the statement already (Sean, 2026-09-16: "yes everything should be
   * cleared except the pending transactions").
   *
   * TRUE BY DEFAULT, which is the opposite of how this started. A bank export
   * is a list of what the bank has done; PENDING is the exception it marks,
   * and everything else in the file — including a blank cell, and including a
   * file with no status column at all — has happened.
   */
  cleared: boolean;
};

/** A line that could not be read, and why — never silently dropped. */
export type CsvProblem = { line: number; reason: string; text: string };

/**
 * What a file turned into.
 *
 * `problems` are lines that could NOT be read — damage, to go and look at.
 * `skipped` are lines read perfectly well and deliberately left out, which is
 * a different thing and must not be reported as breakage: a clean import of a
 * file with two voided rows should not warn about two unreadable lines.
 * Neither list is ever silently empty — see the note on `problems`.
 */
export type CsvRead = { rows: CsvRow[]; problems: CsvProblem[]; skipped: CsvProblem[] };

/** Column names this understands, lowercased. First match wins. */
const HEADERS = {
  date: ['date', 'transaction date', 'posted date', 'post date'],
  description: ['description', 'memo', 'payee', 'details'],
  amount: ['amount', 'value'],
  /** Whatever the bank calls the column that says it has posted. */
  cleared: ['cleared', 'status', 'state', 'posted', 'reconciled'],
};

/**
 * The two things a status column can say that are not "this happened".
 *
 * PENDING is money the bank has not settled: it belongs in the ledger,
 * because it is going to leave the account, but it is not on the statement.
 *
 * VOID is money that never moved — Sean, 2026-09-16: "drop any transactions
 * that don't count like void". A voided or returned row in the file is the
 * bank telling you about something it then unwound, and importing it puts a
 * transaction in the ledger that no balance will ever account for.
 *
 * Everything else is cleared. The lists are the exceptions precisely because
 * a bank writes far more words for "done" — posted, complete, a bare `*`, an
 * empty cell — than it does for the two states that are not.
 */
const PENDING_WORDS = ['pending', 'processing', 'hold', 'authorization', 'authorized', 'unposted'];
const VOID_WORDS = ['void', 'voided', 'cancel', 'cancelled', 'canceled', 'returned', 'reversed', 'declined', 'failed', 'denied'];

const statusOf = (cell: string): 'cleared' | 'pending' | 'void' => {
  const w = cell.trim().toLowerCase();
  if (VOID_WORDS.includes(w)) return 'void';
  if (PENDING_WORDS.includes(w)) return 'pending';
  return 'cleared';
};

const findCol = (head: readonly string[], want: readonly string[]): number =>
  head.findIndex((h) => want.includes(h.trim().toLowerCase()));

/**
 * `MM/DD/YYYY` to `YYYY-MM-DD`, and nothing cleverer.
 *
 * No `Date` anywhere near it. `new Date('09/15/2026')` is parsed in the
 * runtime's own timezone and `toISOString()` then shifts it — the bug day.ts
 * exists to avoid, and the one that would move a whole ledger by a day for
 * anyone west of UTC.
 */
export function usDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(text);
  if (m === null) return null;
  const [, mm, dd, yyyy] = m;
  const day = `${yyyy}-${(mm as string).padStart(2, '0')}-${(dd as string).padStart(2, '0')}`;
  return isDay(day) ? day : null;
}

/**
 * Read a whole export.
 *
 * Every line that cannot be read comes back in `problems` with its line
 * number. Nothing is skipped quietly: a bank file with three unreadable rows
 * that imports 1949 and says "done" is how you find out months later that
 * something is missing.
 */
export function readCsv(text: string): CsvRead {
  const table = parseDelimited(text);
  const rows: CsvRow[] = [];
  const problems: CsvProblem[] = [];
  const skipped: CsvProblem[] = [];
  if (table.length === 0) return { rows, problems, skipped };

  const head = table[0] as string[];
  const iDate = findCol(head, HEADERS.date);
  const iDesc = findCol(head, HEADERS.description);
  const iAmt = findCol(head, HEADERS.amount);
  // OPTIONAL, like the description: a file without it still imports, with
  // every row uncleared, which is exactly what it was doing before.
  const iCleared = findCol(head, HEADERS.cleared);
  if (iDate < 0 || iAmt < 0) {
    return {
      rows,
      problems: [{
        line: 1,
        reason: 'no DATE and AMOUNT columns in the header',
        text: head.join(','),
      }],
      skipped,
    };
  }

  for (let i = 1; i < table.length; i++) {
    const r = table[i] as string[];
    const line = i + 1;
    const raw = (r[iDate] ?? '').trim();
    const day = usDate(raw);
    if (day === null) {
      problems.push({ line, reason: `unreadable date ${JSON.stringify(raw)}`, text: r.join(',') });
      continue;
    }
    const cents = parseAmount(r[iAmt] ?? '');
    if (cents === null) {
      problems.push({
        line,
        reason: `unreadable amount ${JSON.stringify(r[iAmt] ?? '')}`,
        text: r.join(','),
      });
      continue;
    }
    const status = iCleared < 0 ? 'cleared' : statusOf(r[iCleared] ?? '');
    if (status === 'void') {
      // Read fine, deliberately left out — `skipped`, never `problems`.
      skipped.push({ line, reason: `${squash(r[iCleared] ?? '')} — does not count`, text: r.join(',') });
      continue;
    }
    rows.push({
      date: day,
      description: squash(iDesc < 0 ? '' : r[iDesc] ?? ''),
      amount: cents,
      cleared: status === 'cleared',
    });
  }
  return { rows, problems, skipped };
}

/** Runs of whitespace to one space, ends trimmed. Bank exports are padded. */
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ *
 * Naming the row
 *
 * The bank's description is kept verbatim on the record. This produces the
 * short NAME a person reads in the list, and it is cosmetic by design: get it
 * wrong and the row is still correct, still searchable, and still carries the
 * original text. That is why it is allowed to be a pile of patterns.
 * ------------------------------------------------------------------ */

const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA'
  + '|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT'
  + '|VA|WA|WV|WI|WY|DC';

/** `SEWARD COMM COOP` -> `Seward Comm Coop`, leaving `PP*` style alone. */
function titled(s: string): string {
  return s
    .split(' ')
    .map((w) => (/[a-z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ')
    // `Domino'S` and `Sean'S` are what a naive title-case does to an apostrophe.
    .replace(/([a-z])'S\b/g, "$1's");
}

/**
 * A short, readable name for a Wells Fargo description.
 *
 * Measured against Sean's 1952-row export: it turns 1952 lines into about 500
 * distinct names, with the top of the list reading Amazon / Apple / Instacart
 * / Uber Eats rather than `PURCHASE AUTHORIZED ON 09/10 PP*INSTACART
 * 4029357733 CA S584...`.
 *
 * It is deliberately a ladder of specific cases before a general cleanup,
 * because the general cleanup cannot know that `ZELLE TO VIETOR AUTUMN ON
 * 09/14 REF # WFCT22N9C8LH` is about a person and the reference is noise.
 */
export function wellsFargoName(description: string): string {
  const s = squash(description);
  if (s === '') return 'Transaction';

  // Transfers between people: the counterparty is the whole point, the
  // reference number is never once useful in a list.
  const zelle = /^ZELLE (TO|FROM) (.+?) ON \d\d\/\d\d REF/i.exec(s);
  if (zelle !== null) {
    return `${zelle[1]?.toUpperCase() === 'TO' ? 'Zelle to' : 'Zelle from'} ${titled(zelle[2] as string)}`;
  }

  if (/^NON-WF ATM WITHDRAWAL/i.test(s)) return 'ATM withdrawal';
  if (/^NON-WELLS FARGO ATM TRANSACTION FEE/i.test(s)) return 'ATM fee';
  if (/^ATM (CASH )?(WITHDRAWAL|DEPOSIT)/i.test(s)) return titled(s.slice(0, 20)).trim();

  const paypal = /^PAYPAL\s+(TRANSFER|INST XFER|PURCHASE|ECHECK|VERIFYBANK)/i.exec(s);
  if (paypal !== null) {
    const kind = (paypal[1] as string).toUpperCase();
    return kind === 'PURCHASE' ? 'PayPal purchase'
      : kind === 'ECHECK' ? 'PayPal eCheck'
      : kind === 'VERIFYBANK' ? 'PayPal verification'
      : 'PayPal transfer';
  }

  if (/^WOLFRAM RESEARCH/i.test(s)) return 'Wolfram Research payroll';
  if (/^VANGUARD GROUP/i.test(s)) return 'Vanguard Group';

  // The general case: drop the ceremony, then the trailing junk, in order —
  // card number, reference code, phone, long digit runs, then the city and
  // state the card network appends.
  let out = s
    .replace(/^(PURCHASE|RECURRING PAYMENT|NON-WF ATM WITHDRAWAL)\s+AUTHORIZED ON\s+\d\d\/\d\d\s+/i, '')
    .replace(/^(PURCHASE|RECURRING PAYMENT|RECURRING TRANSFER)\s+/i, '')
    .replace(/\s+CARD\s?\d+$/i, '')
    .replace(/\s+[A-Z]\d{6,}\s*$/i, '')
    .replace(/\s+\d{3}-\d{3}-\d{4}\b/g, '')
    .replace(/\s+\d{9,}\b/g, '');

  // `... SEWARD COMM COOP 7 MINNEAPOLIS MN` -> drop `MINNEAPOLIS MN` as one
  // unit. Up to three trailing words before the state code, because a city
  // can be `SAN FRANCISCO` or `NEW HOPE`.
  out = out.replace(
    new RegExp(`\\s+(?:[A-Za-z][\\w.'-]*\\s+){0,2}[A-Za-z][\\w.'-]*\\s+(?:${STATES})$`),
    '',
  );
  // A bare trailing state, with no city before it.
  out = out.replace(new RegExp(`\\s+(?:${STATES})$`), '');

  // Payment-processor prefixes. The processor is not the merchant.
  out = out.replace(/^(PP\*|SQ ?\*|TST\* ?|IN \*|SP |PAYPAL \*)/i, '');

  // The handful worth naming outright, because they are the top of the list.
  if (/^APPLE\.COM/i.test(out)) return 'Apple';
  if (/^(AMAZON|AMZN)\b/i.test(out)) return 'Amazon';
  if (/^UBER\s*\*?\s*EATS/i.test(out)) return 'Uber Eats';
  if (/^UBER\b/i.test(out)) return 'Uber';
  if (/^IC\*/i.test(out)) return 'Instacart';
  if (/^INSTACART/i.test(out)) return 'Instacart';

  out = squash(out);
  return out === '' ? titled(s) : titled(out);
}

/* ------------------------------------------------------------------ *
 * Turning rows into records
 * ------------------------------------------------------------------ */

/**
 * What makes two lines "the same transaction".
 *
 * There is no id in the file, so this is the only handle there is: the day,
 * the exact cents, and the bank's own raw text. The NAME is deliberately not
 * in it — renaming the cleanup rules must never make an already-imported row
 * look new.
 */
export function importKey(row: { date: string; description: string; amount: number }): string {
  return [row.date, row.amount, row.description].join(SEP);
}

/**
 * The separator, BUILT rather than written as an escape.
 *
 * It has to be a character a bank description cannot contain, and it must not
 * appear literally in this file: a source file with a real control byte in it
 * is one git calls binary, which silently costs every diff, blame and grep on
 * it. That happened here on the first write of this module.
 */
const SEP = String.fromCharCode(31);

/* ------------------------------------------------------------------ *
 * The second import, and every one after it
 *
 * Sean, 2026-09-18: "if it goes back enough days which it usually will..
 * check if any transactions no longer exist in the csv, or if any values need
 * to be modified (final amounts, whether it's cleared)".
 *
 * A bank export is not a list of new things — it is the bank's CURRENT
 * account of a stretch of days, and the second export of an overlapping
 * stretch is the bank changing its mind out loud. Three things it says:
 *
 *   A PENDING ROW SETTLED. The amount moves (a tip, a fuel hold), the date
 *   often moves with it, and the status goes from pending to posted.
 *   A ROW CLEARED. Everything else the same; only the status moved.
 *   A ROW WENT AWAY. An authorization the merchant never captured. The money
 *   never moved, and the ledger is carrying a transaction no statement will
 *   ever account for.
 *
 * Importing over the top of that without looking leaves the settled row
 * beside its own pending ghost and the dead authorization for ever, which is
 * exactly what every import before today did.
 * ------------------------------------------------------------------ */

/**
 * How far a transaction may move when it settles and still be the same one.
 *
 * Four days. A card authorization posts in one to three, and a weekend pushes
 * the far end out; past that the resemblance is a coincidence, and matching
 * on it would fold two genuine visits to the same shop into one.
 */
export const SETTLE_DRIFT = 4;

/** A row the file has CHANGED: what is in the ledger, and what it now says. */
export type ImportChange = { txn: Txn; row: CsvRow };

/** How an import treats what is already in the account. */
export type ImportMode = 'add' | 'replace';

export type ImportPlan = {
  /** The rows that would become records. */
  adding: readonly CsvRow[];
  /** Live rows in the account that would be tombstoned. `replace` only. */
  removing: readonly Txn[];
  /** Lines the ledger already has, unchanged. `add` only. */
  duplicates: number;
  /** Rows the file has changed — settled, or newly cleared. `add` only. */
  updating: readonly ImportChange[];
  /** Live rows INSIDE the file's span that the file no longer has. */
  missing: readonly Txn[];
};

/** Is `b` within `days` either side of `a`? On the string, never a Date. */
const near = (a: string, b: string, days: number): boolean =>
  b >= addDays(a, -days) && b <= addDays(a, days);

/** How far apart two days are, up to `max`, or `max + 1` for "further". */
function drift(a: string, b: string, max: number): number {
  for (let n = 0; n <= max; n++) {
    if (addDays(a, n) === b || addDays(a, -n) === b) return n;
  }
  return max + 1;
}

/**
 * A row the file could be talking ABOUT — one that came from a bank.
 *
 * The bank's raw text is on every imported row and on almost no hand-typed
 * one, and it is the only handle there is: nothing on a `Txn` says where it
 * came from. So a row with no description is left alone entirely — never
 * matched loosely, never reported missing — because the alternative is an
 * import quietly removing the cash somebody entered by hand.
 */
const fromBank = (t: Txn): boolean => t.description !== '';

/**
 * Line the file up against what the account already holds.
 *
 * Two passes, and the order is the rule:
 *
 *   EXACT first — same day, same cents, same bank text (`importKey`). That is
 *   the same transaction beyond argument, and anything it claims is settled.
 *   Only the cleared flag can differ, and when it does that is an update.
 *
 *   NEAR second, and only over what the first pass did not take: same bank
 *   text, within `SETTLE_DRIFT` days, nearest day first. This is the pending
 *   row that posted for a different amount. Running it second is what stops
 *   it stealing a row that had an exact match waiting.
 *
 * What is left over on each side is the answer: file rows nobody claimed are
 * NEW, and bank-sourced ledger rows inside the file's span that nobody
 * claimed are GONE.
 *
 * The span matters as much as the matching. Rows older than the file reaches
 * are none of its business, and neither is one dated after its last day —
 * which is what a transaction entered by hand this morning, from a file
 * exported last night, actually is.
 */
export function reconcileRows(incoming: readonly CsvRow[], existing: readonly Txn[]): {
  adding: CsvRow[]; updating: ImportChange[]; missing: Txn[]; duplicates: number;
} {
  if (incoming.length === 0) {
    return { adding: [], updating: [], missing: [], duplicates: 0 };
  }
  let first = incoming[0]!.date;
  let last = first;
  for (const r of incoming) {
    if (r.date < first) first = r.date;
    if (r.date > last) last = r.date;
  }
  const live = existing.filter((t) => t.deleted !== true);
  /** The days the file COVERS — the only ones it can say are gone. */
  const span = live.filter((t) => t.date >= first && t.date <= last);
  /**
   * The days it can MATCH over, which reach a little further back.
   *
   * A pending row dated the day before the file starts can be the same
   * transaction as the settled one on its first day, and refusing to see that
   * leaves the ghost sitting in the ledger for ever with its own settled twin
   * beside it. Reaching BACK is safe in a way that reaching back for
   * `missing` would not be: a match needs the bank's own text to agree, where
   * a removal needs only silence.
   *
   * It does not reach FORWARD past the file's last day, and that asymmetry is
   * the point: a row dated after the file was exported is one somebody
   * entered since, and dragging it back onto the statement's last week would
   * rewrite a date nobody asked to change.
   */
  const nearby = live.filter((t) => t.date >= addDays(first, -SETTLE_DRIFT) && t.date <= last);

  // Pass one: exact, counted rather than collapsed — three identical $50
  // Zelles on one day are three transactions, and a set would make them one.
  const byKey = new Map<string, Txn[]>();
  for (const t of span) {
    const k = importKey(t);
    const at = byKey.get(k);
    if (at === undefined) byKey.set(k, [t]); else at.push(t);
  }
  const taken = new Set<string>();
  const updating: ImportChange[] = [];
  const unclaimed: CsvRow[] = [];
  let duplicates = 0;
  for (const row of incoming) {
    const t = byKey.get(importKey(row))?.shift();
    if (t === undefined) { unclaimed.push(row); continue; }
    taken.add(t.id);
    if ((t.cleared === true) !== row.cleared) updating.push({ txn: t, row });
    else duplicates++;
  }

  // Pass two: the pending row that settled for a different amount.
  const adding: CsvRow[] = [];
  for (const row of unclaimed) {
    let best: Txn | undefined;
    let bestAt = SETTLE_DRIFT + 1;
    if (row.description !== '') {
      for (const t of nearby) {
        if (taken.has(t.id) || !fromBank(t) || t.description !== row.description) continue;
        if (!near(t.date, row.date, SETTLE_DRIFT)) continue;
        const at = drift(t.date, row.date, SETTLE_DRIFT);
        if (at < bestAt) { best = t; bestAt = at; }
      }
    }
    if (best === undefined) adding.push(row);
    else { taken.add(best.id); updating.push({ txn: best, row }); }
  }

  const missing = span.filter((t) => !taken.has(t.id) && fromBank(t));
  return { adding, updating, missing, duplicates };
}

/**
 * What an import WOULD do, computed before anything is written.
 *
 * Separate from `applyImport` so the screen can say "1,952 to add, 12 already
 * here" and a person can decide. An import that reports what it did after
 * doing it is an import you have to undo.
 */
export function planImport(
  store: Store,
  account: string,
  rows: readonly CsvRow[],
  mode: ImportMode,
): ImportPlan {
  const live = store.txns.filter((t) => t.deleted !== true && t.account === account);
  if (mode === 'replace') {
    return { adding: rows, removing: live, duplicates: 0, updating: [], missing: [] };
  }
  const { adding, updating, missing, duplicates } = reconcileRows(rows, live);
  return { adding, removing: [], duplicates, updating, missing };
}

/**
 * Carry out the plan.
 *
 * `replace` TOMBSTONES rather than deletes, like every other removal here: a
 * row dropped from this device has to travel to the others as a delete, and a
 * row that merely vanishes comes straight back on the next merge.
 *
 * `now` and `id` are arguments so a test can pin both — the impure parts stay
 * at the edge, as everywhere else in core.
 */
export function applyImport(
  store: Store,
  account: string,
  plan: ImportPlan,
  now: number,
  id: () => string = newId,
): Store {
  const dead = new Set([...plan.removing, ...plan.missing].map((t) => t.id));
  const changed = new Map(plan.updating.map((c) => [c.txn.id, c.row]));
  const kept = store.txns.map((t) => {
    if (dead.has(t.id)) return tombstone(t, now);
    const row = changed.get(t.id);
    if (row === undefined) return t;
    // NAME and CATEGORY are left alone, and that is the point of updating a
    // row rather than replacing it: a pending charge somebody already filed
    // under Groceries and renamed stays filed and stays renamed when it
    // settles. Only what the bank is telling us moves.
    //
    // `cleared` is rebuilt rather than assigned, for the reason the field
    // exists: an uncleared row carries NO key at all (see Txn.cleared), so a
    // row that has gone back to pending has to LOSE the key, not hold false.
    const { cleared: _was, ...rest } = t;
    return touch({
      ...rest,
      amount: row.amount,
      date: row.date,
      ...(row.cleared ? { cleared: true as const } : {}),
    }, now);
  });

  // Ordered oldest-first so a custom sort opens on something sensible rather
  // than the file's own order, which is newest-first.
  const byDate = [...plan.adding].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const base = kept.reduce((m, t) => Math.max(m, t.order), 0);

  const added: Txn[] = byDate.map((row, i) => ({
    id: id(),
    name: wellsFargoName(row.description),
    description: row.description,
    amount: row.amount,
    date: row.date,
    account,
    category: null,
    order: base + (i + 1) * REORDER_GAP,
    created: now,
    updated: now,
    // Spread, never `cleared: row.cleared` — an uncleared row carries NO key
    // at all (see Txn.cleared), so writing `false` would make every imported
    // row differ from one written by hand and give the merge something to
    // disagree about.
    ...(row.cleared ? { cleared: true as const } : {}),
  }));

  return { ...store, txns: [...kept, ...added] };
}
