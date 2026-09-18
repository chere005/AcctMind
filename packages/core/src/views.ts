/**
 * VIEWS — which budget set the Budget tab is reading, and how a set is named.
 *
 * Sean, 2026-09-16: a `View:` dropdown over the budget with Month, All Time,
 * and New View; "in this view, budget changes are unique to that view only",
 * and of Month: "the budget set for that particular month.. each month is
 * basically its own view".
 *
 * So a VIEW IS A BUDGET SET, and a set is named by a KEY:
 *
 *   'all'           All Time — the amounts on the lines themselves
 *   'm:YYYY-MM'     one month, each its own set
 *   'v:<id>'        a named view
 *
 * WHY THE LINE KEEPS ITS OWN `budget`. The All Time set is `Line.budget`,
 * untouched, so nothing that exists migrates and a store that never opens the
 * dropdown behaves exactly as it did. Every other set is `BudgetAmount`
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
 * A NAMED VIEW STILL FALLS BACK, and that is not an inconsistency. A view is
 * one what-if budget with no calendar under it, so there is no "unassigned
 * month" to be honest about; starting it from what the lines normally hold is
 * the whole point of being able to ask what if.
 *
 * WHAT CARRIES. Sean, same day: "assignments that aren't spent by the end of
 * the month carry over." A line's available in a month is therefore not its
 * own arithmetic but a running one — everything assigned to it up to and
 * including that month, plus everything it has spent. `assignedBefore` is the
 * first half; the ledger is the second, and budget.ts adds them.
 */
import type { BudgetAmount, Line, View } from './types';

/* The helpers take the COLLECTION they read, not the whole Store — a screen
 * holds `budgets` as a prop and should not have to hold a Store to ask what a
 * line is budgeted. A Store satisfies both shapes structurally, so every
 * caller that has one still passes it whole. */
type HasBudgets = { budgets: readonly BudgetAmount[] };
type HasViews = { views: readonly View[] };

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

/** The set key for a named view. */
export function viewSet(id: string): string {
  return `v:${id}`;
}

/** `YYYY-MM` for a `YYYY-MM-DD` day, or for a Date's local calendar month. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/**
 * The id a (set, line) amount has, derived so two devices agree.
 *
 * `|` cannot appear in either half: a set key is 'all', 'm:' + a date, or
 * 'v:' + an id, and ids are generated from the same alphabet everywhere.
 */
export function budgetId(set: string, line: string): string {
  return `${set}|${line}`;
}

/** Live views, in order. */
export function viewsOf(store: HasViews): View[] {
  return store.views.filter((v) => !v.deleted).slice().sort((a, b) => a.order - b.order);
}

/**
 * What this line is budgeted in this set.
 *
 * All Time reads the line. A MONTH reads its own record and nothing else — an
 * unassigned month is assigned zero. A named view reads its own record and
 * falls back to the line. See the head comment for why the two differ.
 */
export function budgetIn(store: HasBudgets, set: string, line: Line): number {
  if (set === ALL_TIME) return line.budget;
  const row = store.budgets.find((b) => b.id === budgetId(set, line.id) && !b.deleted);
  if (row !== undefined) return row.amount;
  return setMonth(set) === null ? line.budget : 0;
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
export function assignedBefore(store: HasBudgets, month: string, line: string): number {
  return store.budgets.reduce((n, b) => {
    if (b.deleted || b.line !== line) return n;
    const m = setMonth(b.set);
    return m !== null && m < month ? n + b.amount : n;
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
