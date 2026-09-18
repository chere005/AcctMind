/**
 * Importing a bank export: the parts that are about the LEDGER rather than
 * about the file. The file-shaped rules are vectors in `spec/csv.json`.
 */
import { describe, expect, it } from 'vitest';
import {
  STORE_VERSION, applyImport, planImport, readCsv, reconcileRows, removeCategoryDeep,
} from '../src/index';
import type { Category, CsvRow, Line, Store, Txn } from '../src/index';

const ACCT = { id: 'a1', name: 'Sean', color: '#4c8bf0', order: 0, created: 1, updated: 1 };

const store = (txns: Txn[] = [], extra: Partial<Store> = {}): Store => ({
  v: STORE_VERSION, txns, accounts: [ACCT], categories: [], lines: [], views: [], budgets: [], ...extra,
});

const txn = (over: Partial<Txn> = {}): Txn => ({
  id: 't1', name: 'x', description: 'RAW', amount: -100, date: '2026-09-15',
  account: 'a1', category: null, order: 0, created: 1, updated: 1, ...over,
});

const row = (over: Partial<CsvRow> = {}): CsvRow =>
  ({ date: '2026-09-15', description: 'RAW', amount: -100, cleared: true, ...over });

describe('reading a file', () => {
  const HEAD = '"DATE","DESCRIPTION","AMOUNT","CHECK #","STATUS"';

  it('reads the real export shape', () => {
    const r = readCsv(`${HEAD}\n"09/15/2026","PURCHASE APPLE.COM/US","-8.93","","Pending"\n`);
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([{ date: '2026-09-15', description: 'PURCHASE APPLE.COM/US', amount: -893, cleared: false }]);
  });

  it('finds the columns by NAME, not by position', () => {
    // A bank that reorders its columns must not silently import the amount as
    // a date — which is what an index-based reader would do.
    const r = readCsv('"Amount","Date","Memo"\n"-8.93","09/15/2026","APPLE"\n');
    expect(r.rows[0]).toEqual({ date: '2026-09-15', description: 'APPLE', amount: -893, cleared: true });
  });

  it('REPORTS a line it cannot read instead of skipping it', () => {
    // The whole reason problems come back: a file with three unreadable rows
    // that imports 1,949 and says "done" is how you find out months later.
    const r = readCsv(`${HEAD}\n"nonsense","X","-8.93","",""\n"09/15/2026","Y","nope","",""\n`);
    expect(r.rows).toEqual([]);
    expect(r.problems.map((p) => p.line)).toEqual([2, 3]);
    expect(r.problems[0]?.reason).toContain('date');
    expect(r.problems[1]?.reason).toContain('amount');
  });

  it('refuses a file with no date or amount column, and says so', () => {
    const r = readCsv('"Whatever","Else"\n"a","b"\n');
    expect(r.rows).toEqual([]);
    expect(r.problems[0]?.reason).toContain('header');
  });

  it('reads STATUS as cleared, and Pending as not', () => {
    const r = readCsv(
      `${HEAD}\n"09/15/2026","A","-1.00","","Posted"\n"09/16/2026","B","-2.00","","Pending"\n`,
    );
    expect(r.rows.map((x) => x.cleared)).toEqual([true, false]);
  });

  it("takes Wells Fargo's bare * as cleared", () => {
    const r = readCsv('"Date","Amount","Cleared","Description"\n"09/15/2026","-1.00","*","A"\n');
    expect(r.rows[0]?.cleared).toBe(true);
  });

  it('holds an authorization back as pending', () => {
    const r = readCsv(`${HEAD}\n"09/15/2026","A","-1.00","","Hold"\n`);
    expect(r.rows[0]?.cleared).toBe(false);
  });

  it('DROPS a void row rather than importing money that never moved', () => {
    const r = readCsv(
      `${HEAD}\n"09/15/2026","A","-1.00","","Void"\n"09/16/2026","B","-2.00","","Posted"\n`,
    );
    expect(r.rows.map((x) => x.description)).toEqual(['B']);
    // Skipped, NOT a problem: it read perfectly well and was left out on
    // purpose, and a clean import must not warn about unreadable lines.
    expect(r.problems).toEqual([]);
    expect(r.skipped.map((x) => x.line)).toEqual([2]);
    expect(r.skipped[0]?.reason).toContain('does not count');
  });

  it('drops the other words for money that was unwound', () => {
    const body = ['Returned', 'Reversed', 'Declined', 'Cancelled']
      .map((w, i) => `"09/1${i}/2026","X","-1.00","","${w}"`).join('\n');
    const r = readCsv(`${HEAD}\n${body}\n`);
    expect(r.rows).toEqual([]);
    expect(r.skipped).toHaveLength(4);
  });

  it('clears anything that is not pending, including a blank cell', () => {
    const r = readCsv(`${HEAD}\n"09/15/2026","A","-1.00","",""\n`);
    expect(r.rows[0]?.cleared).toBe(true);
  });

  it('clears everything when the file has no status column at all', () => {
    // A bank export is a list of what the bank has DONE; pending is the
    // exception it marks, so a file that marks nothing has marked nothing
    // pending (Sean: "everything should be cleared except the pending").
    const r = readCsv('"Date","Amount","Memo"\n"09/15/2026","-1.00","A"\n');
    expect(r.rows[0]?.cleared).toBe(true);
  });

  it('keeps the third decimal rather than rounding it away', () => {
    // parseAmount's refusal, one level up: 1.005 could be 100 cents or 101,
    // and an import that picks one silently is the bug money.ts exists for.
    const r = readCsv(`${HEAD}\n"09/15/2026","X","-1.005","",""\n`);
    expect(r.rows).toEqual([]);
    expect(r.problems[0]?.reason).toContain('amount');
  });
});

describe('what is already here', () => {
  /** What an import would ADD, given what the account already holds. */
  const adds = (rows: CsvRow[], have: Txn[]) => reconcileRows(rows, have).adding;

  it('counts repeats rather than collapsing them', () => {
    // THE CASE THIS EXISTS FOR. Three identical $50 Zelles on one day are
    // three transactions; a Set would call them one and drop two.
    const three = [row(), row(), row()];
    const cleared = txn({ cleared: true });
    expect(adds(three, []).length).toBe(3);
    expect(adds(three, [cleared]).length).toBe(2);
    expect(adds(three, [{ ...cleared, id: 'a' }, { ...cleared, id: 'b' }]).length).toBe(1);
    expect(adds(three, [
      { ...cleared, id: 'a' }, { ...cleared, id: 'b' }, { ...cleared, id: 'c' },
    ]).length).toBe(0);
  });

  it('marks an imported row cleared when the file says so', () => {
    const rows = [row({ cleared: true }), row({ date: '2026-09-14', cleared: false })];
    const after = applyImport(store(), 'a1', planImport(store(), 'a1', rows, 'add'), 1000, id());
    const on = after.txns.find((t) => t.date === '2026-09-15');
    const off = after.txns.find((t) => t.date === '2026-09-14');
    expect(on?.cleared).toBe(true);
    // ABSENT, not false — an uncleared row carries no key at all, so an
    // imported one is byte-identical to one typed in by hand.
    expect(off && 'cleared' in off).toBe(false);
  });

  it('importing the same file twice adds nothing the second time', () => {
    const rows = [row(), row({ amount: -250 }), row({ date: '2026-09-14' })];
    const once = applyImport(store(), 'a1', planImport(store(), 'a1', rows, 'add'), 1000, id());
    expect(once.txns).toHaveLength(3);
    const twice = reconcileRows(rows, once.txns);
    expect(twice.adding).toEqual([]);
    expect(twice.updating).toEqual([]);
    expect(twice.missing).toEqual([]);
  });

  it('does not count a TOMBSTONE as already here', () => {
    // A row deleted on purpose and then re-imported is a row somebody asked
    // for twice. Treating the tombstone as present would make it impossible
    // to get back without editing the file.
    const dead = { ...txn(), deleted: true as const };
    const again = reconcileRows([row()], [dead]);
    expect(again.adding.length).toBe(1);
    // …and it is not reported as one the file has lost, either.
    expect(again.missing).toEqual([]);
  });

  it('ignores the NAME when matching', () => {
    // Renaming the cleanup rules must never make an imported row look new.
    const r = reconcileRows([row()], [txn({ name: 'something else entirely', cleared: true })]);
    expect(r.adding).toEqual([]);
    expect(r.duplicates).toBe(1);
  });
});

/** Deterministic ids, so a test can say exactly what it expects. */
const id = () => { let n = 0; return () => `id-${++n}`; };

describe('the plan, and carrying it out', () => {
  it('add mode touches nothing the file agrees with', () => {
    const before = store([txn({ cleared: true })]);
    const plan = planImport(before, 'a1', [row(), row({ amount: -999 })], 'add');
    expect(plan.adding).toHaveLength(1);
    expect(plan.duplicates).toBe(1);
    expect(plan.removing).toEqual([]);
    expect(plan.updating).toEqual([]);
    const after = applyImport(before, 'a1', plan, 2000, id());
    expect(after.txns).toHaveLength(2);
    expect(after.txns[0]).toEqual(before.txns[0]);
  });

  it('replace TOMBSTONES the account rather than dropping its rows', () => {
    // A row that merely vanishes from this device comes straight back on the
    // next merge, because the other device still has it live.
    const before = store([txn()]);
    const plan = planImport(before, 'a1', [row({ amount: -500 })], 'replace');
    const after = applyImport(before, 'a1', plan, 2000, id());
    const old = after.txns.find((t) => t.id === 't1');
    expect(old?.deleted).toBe(true);
    expect(old?.updated).toBeGreaterThan(1);
    expect(after.txns.filter((t) => t.deleted !== true)).toHaveLength(1);
  });

  it('replace leaves OTHER accounts alone', () => {
    const before = store([txn(), txn({ id: 't2', account: 'a2' })]);
    const after = applyImport(
      before, 'a1', planImport(before, 'a1', [], 'replace'), 2000, id(),
    );
    expect(after.txns.find((t) => t.id === 't2')?.deleted).toBeUndefined();
  });

  it('gives every imported row a distinct, increasing order', () => {
    const rows = [row({ date: '2026-09-15' }), row({ date: '2026-09-13' }), row({ date: '2026-09-14' })];
    const after = applyImport(store(), 'a1', planImport(store(), 'a1', rows, 'add'), 1000, id());
    const orders = after.txns.map((t) => t.order);
    expect(new Set(orders).size).toBe(3);
    // Oldest first, so a custom sort opens on something sensible rather than
    // the file's own newest-first order.
    expect(after.txns.map((t) => t.date)).toEqual(['2026-09-13', '2026-09-14', '2026-09-15']);
    expect(orders[0]).toBeLessThan(orders[1] as number);
  });

  it('files everything under no category, and keeps the bank text verbatim', () => {
    const after = applyImport(
      store(), 'a1',
      planImport(store(), 'a1', [row({ description: 'PURCHASE PP*INSTACART 402 CA CARD2523' })], 'add'),
      1000, id(),
    );
    expect(after.txns[0]?.category).toBeNull();
    expect(after.txns[0]?.description).toBe('PURCHASE PP*INSTACART 402 CA CARD2523');
    expect(after.txns[0]?.name).toBe('Instacart');
  });
});

/**
 * The second import over the same days — Sean, 2026-09-18: "check if any
 * transactions no longer exist in the csv, or if any values need to be
 * modified (final amounts, whether it's cleared)".
 */
describe('what the file has changed since last time', () => {
  it('a pending row that settled keeps its name and its category', () => {
    // The whole reason this UPDATES rather than deleting and re-adding: the
    // charge somebody already filed under Groceries and renamed stays filed
    // and stays renamed when the tip lands on it.
    const before = store([txn({ name: 'Dinner', category: 'l1' })]);
    const plan = planImport(
      before, 'a1', [row({ date: '2026-09-16', amount: -12550, cleared: true })], 'add',
    );
    expect(plan.adding).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.updating).toHaveLength(1);

    const after = applyImport(before, 'a1', plan, 2000, id());
    const t = after.txns.find((x) => x.id === 't1');
    expect(after.txns.filter((x) => x.deleted !== true)).toHaveLength(1);
    expect(t?.amount).toBe(-12550);
    expect(t?.date).toBe('2026-09-16');
    expect(t?.cleared).toBe(true);
    expect(t?.name).toBe('Dinner');
    expect(t?.category).toBe('l1');
    expect(t?.updated).toBeGreaterThan(1);
  });

  it('a row the file no longer has is an authorization that never landed', () => {
    const ghost = txn({ id: 'ghost', description: 'PURCHASE HOTEL HOLD', date: '2026-09-15' });
    const before = store([ghost]);
    // TWO days in the file, so 09-15 is a day it actually covers — a file is
    // only entitled to say a row is gone from the days it reaches.
    const plan = planImport(
      before, 'a1', [row({ date: '2026-09-14' }), row({ date: '2026-09-16' })], 'add',
    );
    expect(plan.missing.map((t) => t.id)).toEqual(['ghost']);

    const after = applyImport(before, 'a1', plan, 2000, id());
    expect(after.txns.find((t) => t.id === 'ghost')?.deleted).toBe(true);
    // TOMBSTONED, not dropped — a row that merely vanishes from this device
    // comes back on the next merge from another one.
    expect(after.txns.find((t) => t.id === 'ghost')?.updated).toBeGreaterThan(1);
  });

  it('nothing outside the days the file covers is touched', () => {
    // A file exported last night knows nothing about this morning, and
    // nothing about the year before it starts.
    const before = store([
      txn({ id: 'older', date: '2026-08-01' }),
      txn({ id: 'newer', date: '2026-09-20' }),
    ]);
    const plan = planImport(
      before, 'a1',
      [row({ date: '2026-09-14' }), row({ date: '2026-09-16' })],
      'add',
    );
    expect(plan.missing).toEqual([]);
    expect(plan.adding).toHaveLength(2);
  });

  it('a row typed in by hand is never swept, however quiet the file is', () => {
    // Nothing on a Txn says where it came from; the bank's raw text is the
    // only handle. So a row without one is left entirely alone rather than
    // removed because a bank export failed to mention the cash in a pocket.
    const cash = txn({ id: 'cash', description: '', name: 'Farmers market' });
    const before = store([cash]);
    const plan = planImport(before, 'a1', [row({ date: '2026-09-16' })], 'add');
    expect(plan.missing).toEqual([]);
    expect(plan.updating).toEqual([]);
    expect(plan.adding).toHaveLength(1);
  });

  it('a row that has now cleared is updated, and nothing else about it moves', () => {
    const before = store([txn()]);
    const plan = planImport(before, 'a1', [row({ cleared: true })], 'add');
    expect(plan.duplicates).toBe(0);
    expect(plan.updating).toHaveLength(1);

    const after = applyImport(before, 'a1', plan, 2000, id());
    const t = after.txns[0];
    expect(t?.cleared).toBe(true);
    expect(t?.amount).toBe(-100);
    expect(t?.date).toBe('2026-09-15');
  });

  it('a row that went BACK to pending loses the key rather than holding false', () => {
    // The field's own rule: an uncleared row carries no `cleared` key at all,
    // so writing false would make it differ from every hand-typed row and
    // give the merge something to disagree about.
    const before = store([txn({ cleared: true })]);
    const plan = planImport(before, 'a1', [row({ cleared: false })], 'add');
    const after = applyImport(before, 'a1', plan, 2000, id());
    expect(after.txns[0] && 'cleared' in after.txns[0]).toBe(false);
  });

  it('an exact match wins the row, and the near one is left to be reported', () => {
    // Pass order, pinned: if the loose pass ran first it would take the row
    // the exact match was waiting for, and then report the settled one as
    // both new AND gone.
    const before = store([
      txn({ id: 'exact', cleared: true }),
      txn({ id: 'near', date: '2026-09-13', amount: -250 }),
    ]);
    const plan = planImport(
      before, 'a1', [row(), row({ date: '2026-09-13', description: 'OTHER', amount: -999 })], 'add',
    );
    expect(plan.duplicates).toBe(1);
    expect(plan.updating).toEqual([]);
    expect(plan.missing.map((t) => t.id)).toEqual(['near']);
  });

  it('past four days apart it is a coincidence, not the same transaction', () => {
    // Two genuine visits to the same shop in one week must not fold into one.
    const before = store([txn({ id: 'old', date: '2026-09-10' })]);
    const plan = planImport(before, 'a1', [
      row({ date: '2026-09-09', description: 'FILLER', amount: -1 }),
      row({ date: '2026-09-15', amount: -250 }),
    ], 'add');
    expect(plan.updating).toEqual([]);
    expect(plan.adding).toHaveLength(2);
    expect(plan.missing.map((t) => t.id)).toEqual(['old']);
  });

  it('replace says nothing about updates or losses — it takes the lot', () => {
    const before = store([txn()]);
    const plan = planImport(before, 'a1', [row({ cleared: true })], 'replace');
    expect(plan.updating).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.removing).toHaveLength(1);
  });
});

describe('deleting a category takes its lines with it', () => {
  const cat = (id: string): Category => ({ id, name: id, color: '#fff', order: 0, created: 1, updated: 1 });
  const line = (id: string, category: string): Line =>
    ({ id, name: id, category, budget: 500, needs: 0, snoozed: false, order: 0, created: 1, updated: 1 });

  const seeded = (): Store => store(
    [
      txn({ id: 't1', category: 'l1' }),
      txn({ id: 't2', category: 'l2' }),
      txn({ id: 't3', category: null }),
    ],
    { categories: [cat('c1'), cat('c2')], lines: [line('l1', 'c1'), line('l2', 'c2')] },
  );

  it('un-files the transactions instead of leaving them pointing at nothing', () => {
    // Sean, 2026-09-15: they go to "no category". The alternative is money
    // filed against a line that no longer exists — neither in a category nor
    // visibly uncategorised, which is the worst of the three states.
    const after = removeCategoryDeep(seeded(), 'c1', 5000);
    expect(after.txns.find((t) => t.id === 't1')?.category).toBeNull();
    expect(after.txns.find((t) => t.id === 't1')?.deleted).toBeUndefined();
  });

  it('moves the clock on a re-filed row, or another device undoes it', () => {
    const after = removeCategoryDeep(seeded(), 'c1', 5000);
    expect(after.txns.find((t) => t.id === 't1')?.updated).toBeGreaterThan(1);
  });

  it('keeps the money', () => {
    const after = removeCategoryDeep(seeded(), 'c1', 5000);
    expect(after.txns.find((t) => t.id === 't1')?.amount).toBe(-100);
  });

  it('tombstones the category and its lines, and nothing else', () => {
    const after = removeCategoryDeep(seeded(), 'c1', 5000);
    expect(after.categories.find((c) => c.id === 'c1')?.deleted).toBe(true);
    expect(after.categories.find((c) => c.id === 'c2')?.deleted).toBeUndefined();
    expect(after.lines.find((l) => l.id === 'l1')?.deleted).toBe(true);
    expect(after.lines.find((l) => l.id === 'l2')?.deleted).toBeUndefined();
  });

  it('leaves another category\'s transactions filed exactly as they were', () => {
    const after = removeCategoryDeep(seeded(), 'c1', 5000);
    expect(after.txns.find((t) => t.id === 't2')?.category).toBe('l2');
    expect(after.txns.find((t) => t.id === 't2')?.updated).toBe(1);
  });
});
