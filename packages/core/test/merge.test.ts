/**
 * The merge replay, plus the three algebraic properties that make a
 * serverless sync possible at all.
 *
 * The properties are tested over every spec case rather than written as
 * vectors: they are claims about the function, not about any one input.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STORE_VERSION, canonical, live, mergeStores, parseStore, prune, sameStore, tombstone, touch,
} from '../src/index';
import type { Store, Txn } from '../src/index';

type Row = [string, number, 'live' | 'dead', string];
type Case = { name: string; a: Row[]; b: Row[]; want: Record<string, string>; orderDependent?: boolean };

const spec = JSON.parse(
  readFileSync(new URL('../../../spec/merge.json', import.meta.url), 'utf8'),
) as {
  cases: Case[];
  migration: { in: unknown; wantUpdated: number; wantMigrated: boolean };
};

const txn = ([id, updated, state, name]: Row): Txn => ({
  id, name, description: '', amount: 100, date: '2026-08-20', created: 1, updated,
  ...(state === 'dead' ? { deleted: true as const } : {}),
});

const store = (rows: Row[]): Store => ({ v: STORE_VERSION, txns: rows.map(txn) });

/** id -> name, or DEAD for a tombstone. */
const shape = (s: Store): Record<string, string> =>
  Object.fromEntries(s.txns.map((t) => [t.id, t.deleted === true ? 'DEAD' : t.name]));

describe('spec/merge.json', () => {
  for (const c of spec.cases) {
    it(c.name, () => {
      expect(shape(mergeStores(store(c.a), store(c.b)))).toEqual(c.want);
    });

    // The same case the other way round. A merge that only works when the
    // devices happen to sync in one order is not a merge.
    if (c.orderDependent !== true) {
      it(`${c.name} — and the same the other way round`, () => {
        expect(shape(mergeStores(store(c.b), store(c.a)))).toEqual(c.want);
      });
    }
  }

  it('is idempotent: hearing your own write back changes nothing', () => {
    for (const c of spec.cases) {
      const merged = mergeStores(store(c.a), store(c.b));
      expect(shape(mergeStores(merged, merged)), c.name).toEqual(shape(merged));
      // And re-applying either side afterwards is also a no-op.
      expect(shape(mergeStores(merged, store(c.b))), c.name).toEqual(shape(merged));
    }
  });

  it('is associative: the order devices meet in does not matter', () => {
    const c = { a: [['x', 100, 'live', 'one'] as Row], b: [['x', 200, 'live', 'two'] as Row] };
    const third = store([['x', 150, 'live', 'middle'], ['q', 1, 'live', 'other']]);
    const left = mergeStores(mergeStores(store(c.a), store(c.b)), third);
    const right = mergeStores(store(c.a), mergeStores(store(c.b), third));
    expect(shape(left)).toEqual(shape(right));
    expect(shape(left)).toEqual({ x: 'two', q: 'other' });
  });
});

describe('the helpers an edit goes through', () => {
  const base = txn(['x', 100, 'live', 'thing']);

  it('touch moves the clock forward even inside one millisecond', () => {
    // Two edits in the same millisecond would tie, and a tie keeps the
    // incumbent — so the second would be silently dropped by the next merge.
    const once = touch(base, 100);
    const twice = touch(once, 100);
    expect(once.updated).toBe(101);
    expect(twice.updated).toBe(102);
  });

  it('touch survives a clock that goes backwards', () => {
    // A device with the wrong time, or one that has just corrected itself.
    expect(touch(base, 50).updated).toBe(101);
  });

  it('tombstone marks dead and moves the clock', () => {
    const dead = tombstone(base, 500);
    expect(dead.deleted).toBe(true);
    expect(dead.updated).toBe(500);
    // The payload is kept, so a delete arriving somewhere that never saw the
    // record still produces a complete row.
    expect(dead.name).toBe('thing');
  });

  it('live() is what the screens show', () => {
    expect(live([base, tombstone(base, 500)]).map((t) => t.id)).toEqual(['x']);
  });
});

describe('prune', () => {
  const dead = tombstone(txn(['x', 100, 'live', 'gone']), 1_000_000);

  it('keeps a fresh tombstone, because the delete still has to travel', () => {
    const s: Store = { v: STORE_VERSION, txns: [dead] };
    expect(prune(s, 1_000_000 + 1000).txns).toHaveLength(1);
  });

  it('drops one older than the ttl', () => {
    const s: Store = { v: STORE_VERSION, txns: [dead] };
    expect(prune(s, 1_000_000 + 91 * 24 * 3600 * 1000).txns).toHaveLength(0);
  });

  it('never drops a live record, however old', () => {
    const s: Store = { v: STORE_VERSION, txns: [txn(['x', 1, 'live', 'ancient'])] };
    expect(prune(s, Date.now()).txns).toHaveLength(1);
  });
});

describe('a v1 store', () => {
  it('is upgraded rather than refused, with the clock seeded from created', () => {
    const r = parseStore(JSON.stringify(spec.migration.in));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migrated).toBe(spec.migration.wantMigrated);
    expect(r.store.v).toBe(STORE_VERSION);
    expect(r.store.txns[0]?.updated).toBe(spec.migration.wantUpdated);
  });

  it('and a version newer than we read is still refused', () => {
    expect(parseStore(JSON.stringify({ v: 3, txns: [] })).ok).toBe(false);
  });
});

describe('canonical', () => {
  it('makes two agreeing devices serialize identically', () => {
    // The real case: the same three records, merged from opposite directions.
    const a = store([['x', 1, 'live', 'one'], ['y', 2, 'live', 'two']]);
    const b = store([['z', 3, 'live', 'three']]);
    const left = mergeStores(a, b);
    const right = mergeStores(b, a);
    expect(sameStore(left, right)).toBe(true);
    expect(JSON.stringify(canonical(left))).toBe(JSON.stringify(canonical(right)));
  });

  it('still notices a real difference', () => {
    // Without this the whole check would be worthless.
    expect(sameStore(store([['x', 1, 'live', 'one']]), store([['x', 2, 'live', 'one']]))).toBe(false);
    expect(sameStore(store([['x', 1, 'live', 'one']]), store([['x', 1, 'dead', 'one']]))).toBe(false);
    expect(sameStore(store([['x', 1, 'live', 'one']]), store([]))).toBe(false);
  });
});
