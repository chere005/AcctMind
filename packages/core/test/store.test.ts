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
  STORE_VERSION, addTxn, emptyStore, normalizeTxn, parseStore, removeTxn, serialize,
  updateTxn,
} from '../src/index';
import type { Txn } from '../src/index';

const txn = (over: Partial<Txn> = {}): Txn => ({
  id: 'a', name: 'Coffee', description: '', amount: -450,
  date: '2026-08-20', created: 1000, updated: 1000, account: 'a1', category: null, order: 0, ...over,
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
    // One PAST whatever this build writes, so the case stays "from the
    // future" as STORE_VERSION moves. Written as a literal it stopped testing
    // anything the day the store caught up with it.
    const future = STORE_VERSION + 1;
    const r = parseStore(JSON.stringify({ v: future, txns: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`version ${future}`);
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
    // A WELL-FORMED store: the transaction's account exists. Without the
    // account record this does not round-trip, and rightly — see the
    // adoption tests below.
    const base = emptyStore();
    const store = addTxn(
      { ...base, accounts: [{
        id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 0, updated: 0,
      }] },
      txn(),
    );
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


describe('every transaction ends up with an account that exists', () => {
  /*
   * Three ways a transaction can be homeless, and all three end the same way:
   * a home is made, rather than the row being dropped. Losing real money over
   * a bookkeeping detail is the one outcome that is not acceptable here.
   */
  it('adopts the rows of a store that predates accounts', () => {
    const v2 = JSON.stringify({
      v: 2,
      txns: [{
        id: 'x', name: 'Coffee', description: '', amount: -450,
        date: '2026-08-20', created: 1000, updated: 1000,
      }],
    });
    const r = parseStore(v2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migrated).toBe(true);
    expect(r.store.accounts).toHaveLength(1);
    expect(r.store.txns[0]?.account).toBe(r.store.accounts[0]?.id);
    expect(r.store.txns[0]?.category).toBeNull();
  });

  it('and TWO devices migrating the same old ledger arrive at the same account', () => {
    // The reason the id is derived from the oldest transaction rather than
    // generated: an old phone and an old Mac both updating would otherwise
    // each invent an account, and merge to two identical ones nobody can
    // tell apart or merge afterwards.
    const v2 = JSON.stringify({
      v: 2,
      txns: [{
        id: 'x', name: 'Coffee', description: '', amount: -450,
        date: '2026-08-20', created: 1000, updated: 1000,
      }],
    });
    const phone = parseStore(v2);
    const mac = parseStore(v2);
    expect(phone.ok && mac.ok).toBe(true);
    if (!phone.ok || !mac.ok) return;
    expect(phone.store.accounts[0]?.id).toBe(mac.store.accounts[0]?.id);
  });

  it('files rows under an EXISTING account rather than inventing another', () => {
    const raw = JSON.stringify({
      v: 3,
      accounts: [{
        id: 'real', name: 'Current', color: '#4c8bf0', order: 0, created: 1, updated: 1,
      }],
      categories: [],
      txns: [{
        id: 'x', name: 'Coffee', description: '', amount: -450, date: '2026-08-20',
        account: 'vanished', category: null, created: 1, updated: 1,
      }],
    });
    const r = parseStore(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.store.accounts).toHaveLength(1);
    expect(r.store.txns[0]?.account).toBe('real');
  });

  it('forgets a category that has gone, because "none" is already a state', () => {
    // Unlike an account, a missing category needs nothing invented: the model
    // already has a word for a transaction nobody has filed.
    const raw = JSON.stringify({
      v: 3,
      accounts: [{
        id: 'a1', name: 'Current', color: '#4c8bf0', order: 0, created: 1, updated: 1,
      }],
      categories: [],
      txns: [{
        id: 'x', name: 'Coffee', description: '', amount: -450, date: '2026-08-20',
        account: 'a1', category: 'vanished', created: 1, updated: 1,
      }],
    });
    const r = parseStore(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.store.txns[0]?.category).toBeNull();
  });
});
