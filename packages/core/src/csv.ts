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
import { isDay } from './day';
import { newId, REORDER_GAP } from './txn';
import { tombstone } from './merge';
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
};

/** A line that could not be read, and why — never silently dropped. */
export type CsvProblem = { line: number; reason: string; text: string };

export type CsvRead = { rows: CsvRow[]; problems: CsvProblem[] };

/** Column names this understands, lowercased. First match wins. */
const HEADERS = {
  date: ['date', 'transaction date', 'posted date', 'post date'],
  description: ['description', 'memo', 'payee', 'details'],
  amount: ['amount', 'value'],
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
  if (table.length === 0) return { rows, problems };

  const head = table[0] as string[];
  const iDate = findCol(head, HEADERS.date);
  const iDesc = findCol(head, HEADERS.description);
  const iAmt = findCol(head, HEADERS.amount);
  if (iDate < 0 || iAmt < 0) {
    return {
      rows,
      problems: [{
        line: 1,
        reason: 'no DATE and AMOUNT columns in the header',
        text: head.join(','),
      }],
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
    rows.push({
      date: day,
      description: squash(iDesc < 0 ? '' : r[iDesc] ?? ''),
      amount: cents,
    });
  }
  return { rows, problems };
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

/**
 * The lines not already in the ledger, COUNTED rather than collapsed.
 *
 * Three identical $50 Zelles on one day are three transactions, and a set
 * would treat them as one. So this counts what is already filed under each
 * key and keeps the surplus — import the same file twice and the second
 * import adds nothing; import a file with one more repeat and it adds one.
 */
export function newRows(incoming: readonly CsvRow[], existing: readonly Txn[]): CsvRow[] {
  const have = new Map<string, number>();
  for (const t of existing) {
    if (t.deleted === true) continue;
    const k = importKey({ date: t.date, description: t.description, amount: t.amount });
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const out: CsvRow[] = [];
  for (const row of incoming) {
    const k = importKey(row);
    const n = have.get(k) ?? 0;
    if (n > 0) have.set(k, n - 1);
    else out.push(row);
  }
  return out;
}

/** How an import treats what is already in the account. */
export type ImportMode = 'add' | 'replace';

export type ImportPlan = {
  /** The rows that would become records. */
  adding: readonly CsvRow[];
  /** Live rows in the account that would be tombstoned. `replace` only. */
  removing: readonly Txn[];
  /** Lines skipped because the ledger already has them. `add` only. */
  duplicates: number;
};

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
  if (mode === 'replace') return { adding: rows, removing: live, duplicates: 0 };
  const adding = newRows(rows, live);
  return { adding, removing: [], duplicates: rows.length - adding.length };
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
  const dead = new Set(plan.removing.map((t) => t.id));
  const kept = store.txns.map((t) => (dead.has(t.id) ? tombstone(t, now) : t));

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
  }));

  return { ...store, txns: [...kept, ...added] };
}
