import { describe, expect, it } from 'vitest';
import {
  ALL_TIME, assignMany, assignedBefore, budgetId, budgetIn, budgetSetIn, monthOf, monthSet,
  putBudget, setMonth, viewSet, viewsOf,
  type BudgetAmount, type Line, type Store, type View,
} from '../src/index';

const line = (id: string, budget: number): Line => ({
  id, created: 0, updated: 0, name: id, category: 'c1', budget, needs: 0, snoozed: false, order: 0,
});
const amount = (set: string, lineId: string, n: number, extra: Partial<BudgetAmount> = {}): BudgetAmount => ({
  id: budgetId(set, lineId), created: 0, updated: 0, set, line: lineId, amount: n, ...extra,
});
const store = (lines: Line[], budgets: BudgetAmount[] = [], views: View[] = []): Store => ({
  v: 4, txns: [], accounts: [], categories: [], lines, views, budgets,
});

describe('set keys', () => {
  it('names a month and a view apart, and neither is All Time', () => {
    expect(monthSet('2026-09')).toBe('m:2026-09');
    expect(viewSet('v7')).toBe('v:v7');
    expect(monthSet('2026-09')).not.toBe(ALL_TIME);
    expect(viewSet('v7')).not.toBe(ALL_TIME);
  });

  it('takes the month off a day without parsing it as a date', () => {
    expect(monthOf('2026-09-16')).toBe('2026-09');
    // The last day of a month in a zone behind UTC is the trap a Date would
    // have fallen into; this is a string, so there is no zone to be wrong in.
    expect(monthOf('2026-12-31')).toBe('2026-12');
  });

  it('derives the id from the pair, so two devices converge on one record', () => {
    expect(budgetId(monthSet('2026-09'), 'l1')).toBe('m:2026-09|l1');
    expect(budgetId('v:abc', 'l1')).not.toBe(budgetId('v:abd', 'l1'));
  });
});

describe('what a set holds', () => {
  it('All Time is the line itself', () => {
    const s = store([line('l1', 5000)], [amount(monthSet('2026-09'), 'l1', 100)]);
    expect(budgetIn(s, ALL_TIME, s.lines[0]!)).toBe(5000);
  });

  it('a month nobody assigned in holds NOTHING, not the line’s own amount', () => {
    const s = store([line('l1', 5000)]);
    // The whole of "assigned by month": a month that was never funded reads
    // zero, however much the line normally holds. It fell back to the 5000
    // until 2026-09-18, which made every month in the ledger’s history claim
    // to have been assigned.
    expect(budgetIn(s, monthSet('2026-09'), s.lines[0]!)).toBe(0);
    // …and it still says it holds no opinion of its own, which is what an
    // edited month has to be distinguishable from.
    expect(budgetSetIn(s, monthSet('2026-09'), 'l1')).toBeNull();
  });

  it('an assigned month is its own, and the next one is still empty', () => {
    const s = store([line('l1', 5000)], [amount(monthSet('2026-09'), 'l1', 100)]);
    expect(budgetIn(s, monthSet('2026-09'), s.lines[0]!)).toBe(100);
    expect(budgetIn(s, monthSet('2026-10'), s.lines[0]!)).toBe(0);
    expect(budgetIn(s, ALL_TIME, s.lines[0]!)).toBe(5000);
  });

  it('a named view still falls back to the line', () => {
    // A view has no calendar under it, so there is no unassigned month to be
    // honest about — starting from what the line normally holds is the point
    // of being able to ask what if.
    const s = store([line('l1', 5000)]);
    expect(budgetIn(s, viewSet('v7'), s.lines[0]!)).toBe(5000);
    expect(budgetSetIn(s, viewSet('v7'), 'l1')).toBeNull();
  });

  it('a named view is its own set, unaffected by any month', () => {
    const s = store(
      [line('l1', 5000)],
      [amount(monthSet('2026-09'), 'l1', 100), amount(viewSet('v7'), 'l1', 900)],
    );
    expect(budgetIn(s, viewSet('v7'), s.lines[0]!)).toBe(900);
    expect(budgetIn(s, monthSet('2026-09'), s.lines[0]!)).toBe(100);
  });

  it('a deleted amount reads as never assigned, not as the amount it held', () => {
    const s = store([line('l1', 5000)], [amount(monthSet('2026-09'), 'l1', 100, { deleted: true })]);
    expect(budgetIn(s, monthSet('2026-09'), s.lines[0]!)).toBe(0);
    expect(budgetSetIn(s, monthSet('2026-09'), 'l1')).toBeNull();
    // A view’s tombstone still falls back, the same way its absence does.
    const v = store([line('l1', 5000)], [amount(viewSet('v7'), 'l1', 100, { deleted: true })]);
    expect(budgetIn(v, viewSet('v7'), v.lines[0]!)).toBe(5000);
  });

  it('a set may hold zero, which is not the same as holding nothing', () => {
    const s = store([line('l1', 5000)], [amount(monthSet('2026-09'), 'l1', 0)]);
    expect(budgetIn(s, monthSet('2026-09'), s.lines[0]!)).toBe(0);
    expect(budgetSetIn(s, monthSet('2026-09'), 'l1')).toBe(0);
  });
});

describe('setMonth', () => {
  it('reads a month set’s month, and nothing else’s', () => {
    expect(setMonth(monthSet('2026-09'))).toBe('2026-09');
    expect(setMonth(viewSet('v7'))).toBeNull();
    expect(setMonth(ALL_TIME)).toBeNull();
  });
});

describe('assignedBefore — what carries into a month', () => {
  it('adds up every earlier month and stops at this one', () => {
    const s = store([line('l1', 0)], [
      amount(monthSet('2026-07'), 'l1', 100),
      amount(monthSet('2026-08'), 'l1', 250),
      amount(monthSet('2026-09'), 'l1', 900),
      amount(monthSet('2026-10'), 'l1', 700),
    ]);
    expect(assignedBefore(s, '2026-09', 'l1')).toBe(350);
    // The month itself is NOT carried in — it is added by `availableOf` on
    // top of this, and counting it here would double every month’s budget.
    expect(assignedBefore(s, '2026-07', 'l1')).toBe(0);
    expect(assignedBefore(s, '2026-11', 'l1')).toBe(1950);
  });

  it('crosses a year on the string, without a Date anywhere near it', () => {
    const s = store([line('l1', 0)], [
      amount(monthSet('2025-12'), 'l1', 400),
      amount(monthSet('2026-01'), 'l1', 50),
    ]);
    expect(assignedBefore(s, '2026-01', 'l1')).toBe(400);
  });

  it('is deaf to other lines, other kinds of set, and tombstones', () => {
    const s = store([line('l1', 0)], [
      amount(monthSet('2026-08'), 'l2', 111),
      amount(viewSet('v7'), 'l1', 222),
      amount(ALL_TIME, 'l1', 333),
      amount(monthSet('2026-08'), 'l1', 444, { deleted: true }),
      amount(monthSet('2026-08'), 'l1', 10),
    ]);
    // The last two share an id, which a real store cannot do — here it just
    // means the tombstone is skipped and the live one counted.
    expect(assignedBefore(s, '2026-09', 'l1')).toBe(10);
  });

  it('a month that carried nothing in carries nothing', () => {
    expect(assignedBefore(store([line('l1', 5000)]), '2026-09', 'l1')).toBe(0);
  });
});

describe('viewsOf', () => {
  const v = (id: string, name: string, order: number, dead = false): View => ({
    id, created: 0, updated: 0, name, order, ...(dead ? { deleted: true as const } : {}),
  });

  it('is ordered, and leaves the dead out', () => {
    const s = store([], [], [v('b', 'B', 1), v('a', 'A', 0), v('z', 'Z', 2, true)]);
    expect(viewsOf(s).map((x) => x.name)).toEqual(['A', 'B']);
  });
});

describe('putBudget', () => {
  const s = (budgets: BudgetAmount[] = []) => ({ budgets });

  it('writes an amount the set did not hold', () => {
    const next = putBudget(s(), monthSet('2026-09'), 'l1', 250, 1000);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ set: 'm:2026-09', line: 'l1', amount: 250, created: 1000 });
  });

  it('REPLACES rather than adding a second claim on the same pair', () => {
    const first = putBudget(s(), monthSet('2026-09'), 'l1', 250, 1000);
    const again = putBudget(s(first), monthSet('2026-09'), 'l1', 900, 2000);
    expect(again).toHaveLength(1);
    expect(again[0]?.amount).toBe(900);
    // The clock moves and the birthday does not — an edit is not a new record.
    expect(again[0]?.updated).toBe(2000);
    expect(again[0]?.created).toBe(1000);
  });

  it('leaves other sets and other lines alone', () => {
    const base = [
      ...putBudget(s(), monthSet('2026-09'), 'l1', 250, 1000),
      ...putBudget(s(), monthSet('2026-10'), 'l1', 111, 1000),
      ...putBudget(s(), monthSet('2026-09'), 'l2', 222, 1000),
    ];
    const next = putBudget(s(base), monthSet('2026-09'), 'l1', 900, 2000);
    expect(next).toHaveLength(3);
    expect(budgetSetIn(s(next), monthSet('2026-10'), 'l1')).toBe(111);
    expect(budgetSetIn(s(next), monthSet('2026-09'), 'l2')).toBe(222);
    expect(budgetSetIn(s(next), monthSet('2026-09'), 'l1')).toBe(900);
  });
});

describe('assigning to a whole selection at once', () => {
  const SEP = monthSet('2026-09');
  /** A line with a target, and what the screen would hand down beside it. */
  const pick = (l: Line, budgeted: number, spent: number) => ({ line: l, budgeted, spent });

  it('writes the month, never the line — a month is not All Time', () => {
    const l = line('l1', 4000);
    const out = assignMany(store([l]), SEP, [pick(l, 0, -3000)], 'spent', 99)!;
    expect(out).not.toBeNull();
    // The line's own amount is the ALL TIME answer and is untouched.
    expect(out.lines[0]!.budget).toBe(4000);
    expect(out.budgets).toHaveLength(1);
    expect(out.budgets[0]!.amount).toBe(3000);
    expect(out.budgets[0]!.set).toBe(SEP);
  });

  it('All Time writes the LINE, because that is where All Time lives', () => {
    const l = line('l1', 4000);
    const out = assignMany(store([l]), ALL_TIME, [pick(l, 4000, -3000)], 'spent', 99)!;
    expect(out.budgets).toHaveLength(0);
    expect(out.lines[0]!.budget).toBe(3000);
    // A record edit, so it takes the merge clock like any other.
    expect(out.lines[0]!.updated).toBe(99);
  });

  it('is one clock for the whole press, so the writes sort together', () => {
    const a = line('l1', 0); const b = line('l2', 0);
    const out = assignMany(store([a, b]), SEP, [pick(a, 0, -100), pick(b, 0, -200)], 'spent', 77)!;
    expect(out.budgets.map((x) => x.updated)).toEqual([77, 77]);
  });

  it('skips a line that already holds the answer — no record, no sync', () => {
    const l = line('l1', 0);
    // `= 0` over a month nobody has assigned in. Every line already reads
    // zero there, so a bar press that minted a row per line would fill the
    // store with records saying what it already said.
    expect(assignMany(store([l]), SEP, [pick(l, 0, -500)], 'zero', 1)).toBeNull();
  });

  it('keeps the created stamp of a row it overwrites', () => {
    const l = line('l1', 0);
    const had = amount(SEP, 'l1', 500, { created: 5, updated: 5 });
    const out = assignMany(store([l], [had]), SEP, [pick(l, 500, -9000)], 'spent', 99)!;
    expect(out.budgets[0]!.created).toBe(5);
    expect(out.budgets[0]!.updated).toBe(99);
    expect(out.budgets[0]!.amount).toBe(9000);
  });

  it('carries on past a line whose new amount is not an amount', () => {
    const big: Line = { ...line('l1', 0), needs: 0 };
    const ok = line('l2', 0);
    // A spend past MAX_CENTS cannot be matched; the other line was still a
    // legitimate instruction and must not be lost with it.
    const out = assignMany(
      store([big, ok]), SEP,
      [pick(big, 0, -Number.MAX_SAFE_INTEGER), pick(ok, 0, -2500)], 'spent', 99,
    )!;
    expect(out.budgets).toHaveLength(1);
    expect(out.budgets[0]!.line).toBe('l2');
  });

  it('leaves every other line and every other set alone', () => {
    const a = line('l1', 0); const b = line('l2', 0);
    const other = amount(monthSet('2026-08'), 'l1', 700);
    const out = assignMany(store([a, b], [other]), SEP, [pick(a, 0, -100)], 'spent', 99)!;
    expect(out.budgets.find((x) => x.set === monthSet('2026-08'))).toEqual(other);
    expect(out.budgets.filter((x) => x.line === 'l2')).toHaveLength(0);
    expect(out.lines).toHaveLength(2);
  });

  it('reaches the same number the screen would draw, through budgetIn', () => {
    const l = line('l1', 0);
    const out = assignMany(store([l]), SEP, [pick(l, 0, -3000)], 'spent', 99)!;
    // The round trip that matters: what was written is what the budget then
    // READS in that set. A row with the right amount under the wrong id is
    // invisible, and only this direction catches it.
    expect(budgetIn({ budgets: out.budgets }, SEP, l)).toBe(3000);
  });
});
