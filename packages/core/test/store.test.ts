/**
 * The store, and the distinction this whole app depends on:
 * **empty is not the same as broken.**
 *
 * There is no server copy. If a damaged read returned an empty store, the
 * screen would render "no transactions" and the next save would write that
 * emptiness over the only copy someone has. Every test below that asserts
 * `ok: false` is guarding that specific sequence.
 */
import { describe, expect, it } from 'vitest';
import {
  addTxn, emptyStore, normalizeTxn, parseStore, removeTxn, serialize, updateTxn,
} from '../src/index';
import type { Txn } from '../src/index';

const txn = (over: Partial<Txn> = {}): Txn => ({
  id: 'a', name: 'Coffee', description: '', amount: -450,
  date: '2026-08-20', created: 1000, updated: 1000, ...over,
});

describe('a store that was never written', () => {
  it('reads as empty, from null, undefined and blank', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const r = parseStore(raw);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.store.txns).toEqual([]);
    }
  });
});

describe('a store that is damaged', () => {
  // Each of these used to be the same as "empty" in the bug this guards.
  it('refuses unreadable JSON rather than reporting no transactions', () => {
    const r = parseStore('{"v":1,"txns":[');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/);
  });

  it('refuses JSON that is not a store', () => {
    for (const raw of ['[]', '"hello"', '42', 'null', 'true']) {
      expect(parseStore(raw).ok, raw).toBe(false);
    }
  });

  it('refuses a version NEWER than it reads', () => {
    // A file from a newer build. Rendering it would be wrong; saving over it
    // would be worse. (An OLDER version is upgraded instead — see
    // merge.test.ts. The asymmetry is deliberate.)
    const r = parseStore('{"v":3,"txns":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('version 3');
    // No version at all is not a store this build should touch either.
    expect(parseStore('{"txns":[]}').ok).toBe(false);
  });

  it('refuses a store whose transaction list is not a list', () => {
    expect(parseStore('{"v":1}').ok).toBe(false);
    expect(parseStore('{"v":1,"txns":{}}').ok).toBe(false);
  });
});

describe('a store with some bad rows', () => {
  it('keeps the good ones and counts the rest', () => {
    const raw = JSON.stringify({
      v: 1,
      txns: [
        txn({ id: 'good1' }),
        null,
        'nope',
        { id: 'noamount', name: 'x', date: '2026-08-20' },
        { id: 'floaty', name: 'x', amount: 4.5, date: '2026-08-20' },
        { id: 'badday', name: 'x', amount: 100, date: '2026-02-30' },
        { id: '', name: 'x', amount: 100, date: '2026-08-20' },
        txn({ id: 'good2' }),
      ],
    });
    const r = parseStore(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.store.txns.map((t) => t.id)).toEqual(['good1', 'good2']);
    expect(r.dropped).toBe(6);
  });

  it('keeps the first of a duplicated id, so a delete stays unambiguous', () => {
    const raw = JSON.stringify({
      v: 1, txns: [txn({ id: 'dup', name: 'first' }), txn({ id: 'dup', name: 'second' })],
    });
    const r = parseStore(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.store.txns).toHaveLength(1);
    expect(r.store.txns[0]?.name).toBe('first');
    expect(r.dropped).toBe(1);
  });
});

describe('normalizeTxn', () => {
  it('fills a missing description rather than rejecting the row', () => {
    const t = normalizeTxn({ id: 'a', name: 'x', amount: 1, date: '2026-08-20' });
    expect(t?.description).toBe('');
    expect(t?.created).toBe(0);
  });

  it('rejects a float amount outright', () => {
    // Not truncated. A float here means something wrote this file without
    // following the integer rule, and guessing what it meant is how a cent
    // goes missing.
    expect(normalizeTxn({ id: 'a', name: 'x', amount: 0.1 + 0.2, date: '2026-08-20' })).toBeNull();
    expect(normalizeTxn({ id: 'a', name: 'x', amount: 1e300, date: '2026-08-20' })).toBeNull();
  });
});

describe('editing a store', () => {
  it('round-trips through serialize', () => {
    const store = addTxn(emptyStore(), txn());
    const r = parseStore(serialize(store));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.store).toEqual(store);
  });

  it('never mutates what it is handed', () => {
    const before = addTxn(emptyStore(), txn());
    const snapshot = serialize(before);
    addTxn(before, txn({ id: 'b' }));
    removeTxn(before, 'a');
    updateTxn(before, txn({ name: 'changed' }));
    expect(serialize(before)).toBe(snapshot);
  });

  it('removes by id, and shrugs at a miss', () => {
    const store = addTxn(addTxn(emptyStore(), txn()), txn({ id: 'b' }));
    expect(removeTxn(store, 'a').txns.map((t) => t.id)).toEqual(['b']);
    expect(removeTxn(store, 'nope').txns).toHaveLength(2);
  });

  it('updates by id, and shrugs at a miss', () => {
    const store = addTxn(emptyStore(), txn());
    expect(updateTxn(store, txn({ name: 'Tea' })).txns[0]?.name).toBe('Tea');
    expect(updateTxn(store, txn({ id: 'nope', name: 'Tea' })).txns[0]?.name).toBe('Coffee');
  });
});
