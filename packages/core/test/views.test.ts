import { describe, expect, it } from 'vitest';
import {
  ALL_TIME, assignedBefore, budgetId, budgetIn, budgetSetIn, monthOf, monthSet, putBudget,
  setMonth, viewSet, viewsOf,
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
