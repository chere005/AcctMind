/**
 * Which rows still need a category once an account has been reconciled.
 * Sean, 2026-09-18: after a reconcile he is "starting budgeting and tracking
 * transactions that need to be assigned after the reconcile".
 */
import { describe, expect, it } from 'vitest';
import { RECONCILE_NAME, unfiledSince } from '../src/budget';
import type { Txn } from '../src/types';

const t = (id: string, date: string, over: Partial<Txn> = {}): Txn => ({
  id, name: id, description: '', amount: -100, date, account: 'a1', category: null,
  order: 0, created: 1, updated: 1, ...over,
});
const ids = (rows: Txn[]) => rows.map((r) => r.id);

describe('unfiledSince', () => {
  it('with no reconcile, every unfiled row still needs a category', () => {
    expect(ids(unfiledSince([t('a', '2026-09-01'), t('b', '2026-09-02', { category: 'l1' })]))).toEqual(['a']);
  });

  it('a reconcile draws the line: only rows dated after it count', () => {
    const rows = [
      t('old', '2026-09-01'),
      t('same', '2026-09-10'),
      t('rec', '2026-09-10', { name: RECONCILE_NAME, amount: 121425 }),
      t('new', '2026-09-11'),
    ];
    // The reconcile itself never counts — it is an adjustment, not a purchase.
    expect(ids(unfiledSince(rows))).toEqual(['new']);
  });

  it('the LATEST reconcile is the line, whatever order the rows come in', () => {
    const rows = [
      t('x', '2026-09-05'),
      t('rec2', '2026-09-20', { name: RECONCILE_NAME }),
      t('y', '2026-09-15'),
      t('rec1', '2026-09-10', { name: RECONCILE_NAME }),
      t('z', '2026-09-25'),
    ];
    expect(ids(unfiledSince(rows))).toEqual(['z']);
  });

  it('each account has its own line', () => {
    const rows = [
      t('a-old', '2026-09-01'),
      t('a-rec', '2026-09-10', { name: RECONCILE_NAME }),
      t('a-new', '2026-09-12'),
      t('b-old', '2026-09-01', { account: 'b1' }),
    ];
    // b1 was never reconciled, so its old row still counts.
    expect(ids(unfiledSince(rows))).toEqual(['a-new', 'b-old']);
  });

  it('a tombstoned reconcile draws no line', () => {
    const rows = [
      t('old', '2026-09-01'),
      t('rec', '2026-09-10', { name: RECONCILE_NAME, deleted: true }),
    ];
    expect(ids(unfiledSince(rows))).toEqual(['old']);
  });
});
