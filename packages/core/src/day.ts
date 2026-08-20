/**
 * Calendar days as `YYYY-MM-DD` strings.
 *
 * A transaction has a DAY, not an instant. Storing one as a timestamp means
 * every read has to pick a timezone to interpret it in, and the answer
 * changes when the person travels or the server does not agree with the
 * phone. A string is the same day everywhere it is read.
 */

/** A day is 10 characters and a real date on the calendar. */
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);   // rejects 2026-02-30, which the regex allows
}

/**
 * Today, in the LOCAL timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`. That is UTC, so for anyone
 * west of Greenwich it starts calling tomorrow today partway through the
 * evening — six o'clock in Chicago. The date field defaults to today, so
 * that bug would file a transaction on the wrong day for the whole evening
 * and be invisible to anyone testing in the morning.
 */
export function today(now: Date = new Date()): string {
  return dayOf(now);
}

/** The local calendar day a `Date` falls on. */
export function dayOf(d: Date): string {
  return String(d.getFullYear()).padStart(4, '0')
    + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * A day as a local `Date` at midnight — for handing to a platform date
 * picker, which speaks Date and nothing else.
 *
 * `new Date('2026-08-20')` would parse as UTC midnight and hand back the
 * 19th in any western timezone. The numeric constructor is local by
 * definition, which is the whole reason it is used here.
 */
export function dayToDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Days sort as strings — ISO order is calendar order. Kept named for intent. */
export function compareDay(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Shift a day by whole days, staying on the local calendar. */
export function addDays(day: string, n: number): string {
  const d = dayToDate(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * `Aug 20, 2026` — and the year is dropped when it is the current one, which
 * is the common case in a list someone scrolls every day.
 *
 * Hand-rolled for the same reason `formatAmount` is: Hermes may ship without
 * the ICU data `toLocaleDateString` needs, and a date that renders one way
 * in a browser and another on a phone is a bug nobody sees until a phone is
 * in their hand.
 */
export function formatDay(day: string, nowDay: string = today()): string {
  if (!isDay(day)) return day;
  const [y, m, d] = day.split('-') as [string, string, string];
  const mon = MONTHS[Number(m) - 1];
  if (mon === undefined) return day;   // isDay already rules this out; TS does not know it
  const label = mon + ' ' + String(Number(d));
  return y === nowDay.slice(0, 4) ? label : label + ', ' + y;
}

/** The first day of the month a day falls in. */
export function startOfMonth(day: string): string {
  return day.slice(0, 8) + '01';
}

/**
 * Shift by whole months, CLAMPING to the end of the target month.
 *
 * Jan 31 plus one month has no correct answer, only a chosen one. This picks
 * Feb 28 (or 29) rather than rolling into March, because a month picker that
 * skips February when you press 'next' on the 31st is a picker that has lost
 * the person's place. The alternative — letting Date roll over — is what
 * happens if you write `d.setMonth(d.getMonth() + n)` and think no further.
 */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = (total % 12 + 12) % 12 + 1;
  const td = Math.min(d, daysInMonth(ty, tm));
  return String(ty).padStart(4, '0')
    + '-' + String(tm).padStart(2, '0')
    + '-' + String(td).padStart(2, '0');
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                     'August', 'September', 'October', 'November', 'December'] as const;

/** `August 2026` — the heading over a month grid. */
export function monthLabel(day: string): string {
  const [y, m] = day.split('-') as [string, string];
  const name = MONTH_NAMES[Number(m) - 1];
  return name === undefined ? day : name + ' ' + y;
}

/** Sunday first, matching the weekday row every surface draws above the grid. */
export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * The month a day falls in, as weeks of seven.
 *
 * Leading and trailing cells are `null` rather than days from the
 * neighbouring months: a picker that draws them has to decide what a tap on
 * one means, and the honest answer for a one-screen ledger is that there is
 * nothing there. Rows are however many the month needs — 4 (February in a
 * non-leap year starting on Sunday) through 6 — and NOT padded to a fixed
 * six, because a fixed six leaves an empty row that looks like a bug.
 */
export function monthGrid(day: string): (string | null)[][] {
  const first = startOfMonth(day);
  const lead = dayToDate(first).getDay();          // 0 = Sunday, local
  const [y, m] = first.split('-').map(Number) as [number, number];
  const count = daysInMonth(y, m);

  const cells: (string | null)[] = Array<string | null>(lead).fill(null);
  for (let d = 1; d <= count; d++) {
    cells.push(first.slice(0, 8) + String(d).padStart(2, '0'));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** How many days a month has. Exported because the grid is not its only caller. */
export function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}
