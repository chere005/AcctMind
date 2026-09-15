/**
 * Importing a bank export: the parts that are about the LEDGER rather than
 * about the file. The file-shaped rules are vectors in `spec/csv.json`.
 */
import { describe, expect, it } from 'vitest';
import {
  STORE_VERSION, applyImport, newRows, planImport, readCsv, removeCategoryDeep,
} from '../src/index';
import type { Category, CsvRow, Line, Store, Txn } from '../src/index';

const ACCT = { id: 'a1', name: 'Sean', color: '#4c8bf0', order: 0, created: 1, updated: 1 };

const store = (txns: Txn[] = [], extra: Partial<Store> = {}): Store => ({
  v: STORE_VERSION, txns, accounts: [ACCT], categories: [], lines: [], ...extra,
});

const txn = (over: Partial<Txn> = {}): Txn => ({
  id: 't1', name: 'x', description: 'RAW', amount: -100, date: '2026-09-15',
  account: 'a1', category: null, order: 0, created: 1, updated: 1, ...over,
});

const row = (over: Partial<CsvRow> = {}): CsvRow =>
  ({ date: '2026-09-15', description: 'RAW', amount: -100, ...over });

describe('reading a file', () => {
  const HEAD = '"DATE","DESCRIPTION","AMOUNT","CHECK #","STATUS"';

  it('reads the real export shape', () => {
    const r = readCsv(`${HEAD}\n"09/15/2026","PURCHASE APPLE.COM/US","-8.93","","Pending"\n`);
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([{ date: '2026-09-15', description: 'PURCHASE APPLE.COM/US', amount: -893 }]);
  });

  it('finds the columns by NAME, not by position', () => {
    // A bank that reorders its columns must not silently import the amount as
    // a date — which is what an index-based reader would do.
    const r = readCsv('"Amount","Date","Memo"\n"-8.93","09/15/2026","APPLE"\n');
    expect(r.rows[0]).toEqual({ date: '2026-09-15', description: 'APPLE', amount: -893 });
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

  it('keeps the third decimal rather than rounding it away', () => {
    // parseAmount's refusal, one level up: 1.005 could be 100 cents or 101,
    // and an import that picks one silently is the bug money.ts exists for.
    const r = readCsv(`${HEAD}\n"09/15/2026","X","-1.005","",""\n`);
    expect(r.rows).toEqual([]);
    expect(r.problems[0]?.reason).toContain('amount');
  });
});

describe('what is already here', () => {
  it('counts repeats rather than collapsing them', () => {
    // THE CASE THIS EXISTS FOR. Three identical $50 Zelles on one day are
    // three transactions; a Set would call them one and drop two.
    const three = [row(), row(), row()];
    expect(newRows(three, []).length).toBe(3);
    expect(newRows(three, [txn()]).length).toBe(2);
    expect(newRows(three, [txn({ id: 'a' }), txn({ id: 'b' })]).length).toBe(1);
    expect(newRows(three, [txn({ id: 'a' }), txn({ id: 'b' }), txn({ id: 'c' })]).length).toBe(0);
  });

  it('importing the same file twice adds nothing the second time', () => {
    const rows = [row(), row({ amount: -250 }), row({ date: '2026-09-14' })];
    const once = applyImport(store(), 'a1', planImport(store(), 'a1', rows, 'add'), 1000, id());
    expect(once.txns).toHaveLength(3);
    expect(newRows(rows, once.txns)).toEqual([]);
  });

  it('does not count a TOMBSTONE as already here', () => {
    // A row deleted on purpose and then re-imported is a row somebody asked
    // for twice. Treating the tombstone as present would make it impossible
    // to get back without editing the file.
    const dead = { ...txn(), deleted: true as const };
    expect(newRows([row()], [dead]).length).toBe(1);
  });

  it('ignores the NAME when matching', () => {
    // Renaming the cleanup rules must never make an imported row look new.
    expect(newRows([row()], [txn({ name: 'something else entirely' })])).toEqual([]);
  });
});

/** Deterministic ids, so a test can say exactly what it expects. */
const id = () => { let n = 0; return () => `id-${++n}`; };

describe('the plan, and carrying it out', () => {
  it('add mode touches nothing that is already here', () => {
    const before = store([txn()]);
    const plan = planImport(before, 'a1', [row(), row({ amount: -999 })], 'add');
    expect(plan.adding).toHaveLength(1);
    expect(plan.duplicates).toBe(1);
    expect(plan.removing).toEqual([]);
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
