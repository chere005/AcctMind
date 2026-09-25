/**
 * BUDGET SETS — which amounts the Budget tab is reading, and how a set is
 * named.
 *
 * Sean, 2026-09-16, of a month: "the budget set for that particular month..
 * each month is basically its own view". A set is named by a KEY:
 *
 *   'all'           All Time — the amounts on the lines themselves
 *   'm:YYYY-MM'     one month, each its own set
 *
 * WHAT IS GONE, and it is most of why this file was called `views`. There
 * was a `View:` dropdown over the budget from 2026-09-16 — Month, All Time,
 * and New View, "in this view, budget changes are unique to that view only"
 * — with named views keyed `v:<id>` and a `View` record behind each one.
 * Sean removed the dropdown on 2026-09-21 ("always have a month selected")
 * and then the feature ("drop named views"). The screen reads a month and
 * nothing else; `ALL_TIME` stays because `Line.budget` is a real stored
 * number that this key names, and a device that made a named view keeps its
 * `v:` rows in `budgets` where nothing reads them — see BudgetAmount on why
 * they are left rather than migrated away.
 *
 * WHY THE LINE KEEPS ITS OWN `budget`. The All Time set is `Line.budget`,
 * untouched, so nothing that exists migrates and a store written before any
 * of this behaves exactly as it did. Every other set is `BudgetAmount`
 * records layered over it.
 *
 * WHY A RECORD PER (SET, LINE) rather than a map per set. The merge's whole
 * vocabulary is one clock per record (see `Record_`), so a map would make
 * September's groceries and September's rent one clock: two devices editing
 * different lines in the same month, and the later write silently takes back
 * the earlier one. One record per amount is the granularity the edit actually
 * has.
 *
 * WHY THE ID IS DERIVED. `budgetId` is `${set}|${line}`, not a generated id —
 * two devices that first budget the same line in the same month converge on
 * one record instead of two that both claim to be the amount.
 *
 * A MONTH NOBODY HAS ASSIGNED IN HOLDS NOTHING. Sean, 2026-09-18: "the
 * assigned amount should be assigned by month.. previous months will be 0
 * because the month is over and no money was assigned." So an unset month
 * reads ZERO, and assigning in September says nothing about October.
 *
 * It fell back to the line's own amount until then, so that a month you had
 * not touched opened showing what you normally budget. That is a helpful
 * default and a false statement: it made every month in the ledger's history
 * claim to have been funded, and it made the carry-over below meaningless —
 * money cannot roll forward out of a month that was never assigned anything,
 * but under the fallback every month had been.
 *
 * WHAT CARRIES. Sean, same day: "assignments that aren't spent by the end of
 * the month carry over." A line's available in a month is therefore not its
 * own arithmetic but a running one — everything assigned to it up to and
 * including that month, plus everything it has spent. `assignedBefore` is the
 * first half; the ledger is the second, and budget.ts adds them.
 */
import { RECONCILE_NAME, assignedFor, type AssignMode } from './budget';
import { isDay } from './day';
import { touch } from './merge';
import type { BudgetAmount, Line, Setting, Txn } from './types';

/* The helpers take the COLLECTION they read, not the whole Store — a screen
 * holds `budgets` as a prop and should not have to hold a Store to ask what a
 * line is budgeted. A Store satisfies both shapes structurally, so every
 * caller that has one still passes it whole. */
type HasBudgets = { budgets: readonly BudgetAmount[] };

/** The All Time set: the amounts written on the lines themselves. */
export const ALL_TIME = 'all';

/** The set key for a month, `YYYY-MM`. */
export function monthSet(month: string): string {
  return `m:${month}`;
}

/** The `YYYY-MM` a month set is for, or null for any other set. */
export function setMonth(set: string): string | null {
  return set.startsWith('m:') ? set.slice(2) : null;
}

/** `YYYY-MM` for a `YYYY-MM-DD` day, or for a Date's local calendar month. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/**
 * The id a (set, line) amount has, derived so two devices agree.
 *
 * `|` cannot appear in either half: a set key is 'all' or 'm:' + a date,
 * and ids are generated from the same alphabet everywhere.
 */
export function budgetId(set: string, line: string): string {
  return `${set}|${line}`;
}

/**
 * What this line is budgeted in this set.
 *
 * All Time reads the line. A MONTH reads its own record and nothing else —
 * an unassigned month is assigned ZERO, which is the whole of "assigned by
 * month" (see the head comment for what the old fallback cost).
 *
 * The third case went with named views on 2026-09-21: a `v:` set read its
 * own record and fell back to the line, because a what-if budget with no
 * calendar under it has no unassigned month to be honest about. There are
 * no such sets to ask about any more, and a leftover `v:` row that somehow
 * reached this now reads as an unassigned month — zero — which is the safe
 * way for it to be wrong.
 */
export function budgetIn(store: HasBudgets, set: string, line: Line): number {
  if (set === ALL_TIME) return line.budget;
  const row = store.budgets.find((b) => b.id === budgetId(set, line.id) && !b.deleted);
  return row?.amount ?? 0;
}

/**
 * Everything assigned to this line in the months BEFORE this one.
 *
 * HALF of what a line carries into a month. The other half is what it spent
 * in those months, which is the ledger's to answer and not this module's —
 * the two are added by whoever has both, and handed to `availableOf` as one
 * `carry`.
 *
 * Months compare as STRINGS, and correctly: `YYYY-MM` is fixed-width and
 * zero-padded, so '2026-09' < '2026-10' the same way September comes before
 * October. Named views and All Time are skipped — a view has no place in a
 * month's history, and All Time is not a month at all.
 */
export function assignedBefore(
  store: HasBudgets, month: string, line: string, start: string | null = null,
): number {
  return store.budgets.reduce((n, b) => {
    if (b.deleted || b.line !== line) return n;
    const m = setMonth(b.set);
    return m !== null && m < month && (start === null || m >= start) ? n + b.amount : n;
  }, 0);
}

/**
 * The amount a set holds for a line, or null when it holds none.
 *
 * `budgetIn` answers "what shall I draw"; this answers "has this set been
 * given an opinion" — which is what tells a month that has been edited from
 * one that is still showing the line's own number.
 */
export function budgetSetIn(store: HasBudgets, set: string, lineId: string): number | null {
  if (set === ALL_TIME) return null;
  const row = store.budgets.find((b) => b.id === budgetId(set, lineId) && !b.deleted);
  return row === undefined ? null : row.amount;
}

/**
 * Write one amount into one set, replacing whatever that pair held.
 *
 * `putLine`'s twin, and the same shape: the id is derived from the pair, so
 * this is an upsert by construction — there is no "have I budgeted this line
 * in this month before" to get wrong.
 */
export function putBudget(
  store: { budgets: BudgetAmount[] },
  set: string,
  line: string,
  amount: number,
  now: number,
): BudgetAmount[] {
  const id = budgetId(set, line);
  const row: BudgetAmount = {
    id,
    set,
    line,
    amount,
    created: store.budgets.find((b) => b.id === id)?.created ?? now,
    updated: now,
  };
  const has = store.budgets.some((b) => b.id === id);
  return has ? store.budgets.map((b) => (b.id === id ? row : b)) : [...store.budgets, row];
}

/**
 * WHAT EACH LINE CARRIES IN — assigned in an earlier month and still there.
 *
 * Sean, 2026-09-18: "assignments that aren't spent by the end of the month
 * carry over." A line's available in September is everything assigned to it
 * in September and before, plus everything it has ever spent; this is the
 * history half, and `availableOf` adds the month itself.
 *
 * MONTH ONLY, which is why the caller passes the month rather than a set:
 * All Time has no months to carry between and a named view is one what-if
 * budget with no calendar under it, so carrying into either would invent a
 * timeline neither has.
 *
 * A MAP, built in one pass, rather than a function answering one line at a
 * time. The spending half has to look at every transaction older than the
 * month, and doing that once per line turns the whole ledger into an N×M
 * scan on every keystroke of a rename. It was the Budget screen's own
 * `useMemo` until 2026-09-21; the export needs the same number and a second
 * copy of this loop is a second chance to disagree with the screen about
 * what a line is worth.
 */
export function carriedInto(
  store: HasBudgets, month: string, lines: readonly Line[], txns: readonly Txn[],
  start: string | null = null,
): Map<string, number> {
  const by = new Map<string, number>();
  for (const t of countsFrom(txns, start)) {
    if (t.category === null || monthOf(t.date) >= month) continue;
    by.set(t.category, (by.get(t.category) ?? 0) + t.amount);
  }
  const fromMonth = start === null ? null : monthOf(start);
  for (const l of lines) {
    const before = assignedBefore(store, month, l.id, fromMonth);
    if (before !== 0) by.set(l.id, (by.get(l.id) ?? 0) + before);
  }
  return by;
}

/* ------------------------------------------------------------------ *
 * The STARTING DAY.
 *
 * Sean, 2026-09-25: "i'm starting my budget in sept... now that i put in
 * more transactions it doesn't line up... maybe there should be an option
 * under the options drop down for Starting Month", then "i basically started
 * on i think 9/21 after doing a reconcile". Filing earlier spending against a
 * line took it off money that was only assigned afterwards. So the budget
 * has a first DAY — a month was his first word for it and too coarse for
 * the second: nothing dated before it counts against a line, in the month
 * or carried, and no month before its month carries an assignment.
 *
 * `held` is untouched, deliberately. What the accounts hold is everything
 * that ever happened to them; the start only says which of it the lines
 * were ever asked to cover.
 *
 * A ledger `Setting`, not a device pref: two devices that disagreed about it
 * would draw two different budgets.
 * ------------------------------------------------------------------ */

/** The setting's fixed id — the same on every device. */
export const BUDGET_START = 'budgetStart';

type HasSettings = { settings?: readonly Setting[] | undefined };

/** The day the budget starts, `YYYY-MM-DD`, or null for "from the beginning". */
export function budgetStart(store: HasSettings): string | null {
  const row = (store.settings ?? []).find((r) => r.id === BUDGET_START && r.deleted !== true);
  return row !== undefined && isDay(row.value) ? row.value : null;
}

/**
 * Set or clear the starting day. Cleared is `''`, not a tombstone: a setting
 * that flips back and forth is one record with a clock, and a deleted then
 * recreated id is the case `mergeRecords` has to argue about.
 */
export function putBudgetStart(store: HasSettings, day: string | null, now: number): Setting[] {
  const all = store.settings ?? [];
  const had = all.find((r) => r.id === BUDGET_START);
  const row: Setting = had === undefined
    ? { id: BUDGET_START, value: day ?? '', created: now, updated: now }
    : { ...touch(had, now), value: day ?? '' };
  return had === undefined ? [...all, row] : all.map((r) => (r.id === BUDGET_START ? row : r));
}

/** The transactions the budget's lines answer for: dated on or after the start. */
export function countsFrom<T extends { date: string }>(txns: readonly T[], start: string | null): T[] {
  return start === null ? [...txns] : txns.filter((t) => t.date >= start);
}

/**
 * The day a start is OFFERED as when none is set: the latest reconcile, which
 * is where Sean's budget actually began — "after doing a reconcile" — and the
 * line `unfiledSince` already treats as the start of what needs filing. Null
 * when nothing has been reconciled.
 */
export function suggestedStart(txns: readonly Txn[]): string | null {
  let at: string | null = null;
  for (const t of txns) {
    if (t.deleted === true || t.name !== RECONCILE_NAME) continue;
    if (at === null || t.date > at) at = t.date;
  }
  return at;
}

/**
 * Assign to EVERY picked line at once, in one pass and on one clock.
 *
 * Sean, 2026-09-21: the three buttons beside All and Clear. `assignedFor`
 * (budget.ts) is what each one MEANS; this is where the answer lands, and
 * where it lands depends on the set — All Time writes the line itself,
 * everything else writes a row in `budgets`. That split is `budgetIn`'s, read
 * backwards: a helper that always wrote a budgets row would write one with
 * `set: 'all'` that `budgetIn` then ignores, which is a save that reports
 * success and changes nothing.
 *
 * WHAT IS ALREADY RIGHT IS NOT WRITTEN. A line whose amount is already the
 * one asked for is skipped entirely — no `updated`, no record, no sync
 * traffic. That is what keeps `= 0` over a whole budget from minting a
 * budgets row for every line that had nothing assigned in this month
 * anyway: an unassigned month already reads zero.
 *
 * A line whose new amount is not an amount at all — past `MAX_CENTS` — is
 * skipped too, rather than taking the whole press down with it. The other
 * forty lines were a legitimate instruction.
 *
 * `tombstoneMany`'s shape, deliberately (store.ts): one clock for the whole
 * press, so the records this writes sort together on every device. NULL when
 * there was nothing to write at all, which is `moveLineTo`'s idiom one file
 * over — a caller that commits a store identical to the one it had still
 * saves it, publishes it to every peer and re-renders the list.
 */
export function assignMany(
  store: { lines: readonly Line[]; budgets: readonly BudgetAmount[] },
  set: string,
  picks: readonly { line: Line; budgeted: number; spent: number }[],
  mode: AssignMode,
  now: number,
): { lines: Line[]; budgets: BudgetAmount[] } | null {
  const lines = new Map(store.lines.map((l) => [l.id, l]));
  const budgets = new Map(store.budgets.map((b) => [b.id, b]));
  let changed = false;

  for (const { line, budgeted, spent } of picks) {
    const next = assignedFor(mode, line, budgeted, spent);
    if (next === null || next === budgeted) continue;
    changed = true;
    if (set === ALL_TIME) {
      // The All Time amount IS the line's, so this is a record edit and
      // takes the merge clock like any other.
      const was = lines.get(line.id) ?? line;
      lines.set(line.id, touch({ ...was, budget: next }, now));
      continue;
    }
    const id = budgetId(set, line.id);
    const had = budgets.get(id);
    budgets.set(id, {
      id, set, line: line.id, amount: next, created: had?.created ?? now, updated: now,
    });
  }

  if (!changed) return null;
  return { lines: [...lines.values()], budgets: [...budgets.values()] };
}
