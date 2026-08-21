/**
 * The sync plan — the three rules, each tested by the failure it prevents.
 *
 * Pure: no device, no Apple account, no network. That is the point of having
 * `planSync` in core rather than in the app.
 */
import { describe, expect, it } from 'vitest';
import { STORE_VERSION, planSync, serialize } from '../src/index';
import type { Store, Txn } from '../src/index';

const txn = (id: string, updated: number, name = id, dead = false): Txn => ({
  id, name, description: '', amount: 100, date: '2026-08-20', created: 1, updated,
  account: 'a1', category: null, order: 0,
  ...(dead ? { deleted: true as const } : {}),
});
const ACCT = {
  id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 0, updated: 0,
};
const store = (txns: Txn[]): Store =>
  ({ v: STORE_VERSION, txns, accounts: [ACCT], categories: [] });
const NOW = 2_000_000_000_000;

describe('rule 1 — an absent remote is not an empty ledger', () => {
  it('publishes the local ledger and changes nothing here', () => {
    const local = store([txn('a', 100), txn('b', 200)]);
    const plan = planSync(local, null, NOW);
    expect(plan.reason).toBe('no-remote');
    expect(plan.save).toBe(false);
    expect(plan.store).toEqual(local);
    // The whole ledger goes up, not an empty one.
    expect(plan.publish).toBe(serialize(local));
  });

  it('and does the same from an empty device — the remote still gets seeded', () => {
    const plan = planSync(store([]), null, NOW);
    expect(plan.publish).not.toBeNull();
  });
});

describe('rule 2 — publish only when the result is news', () => {
  it('publishes nothing when the remote already agrees', () => {
    // The echo of our own write. If this published, the other device would
    // wake, publish back, and the two would never stop.
    const local = store([txn('a', 100)]);
    const plan = planSync(local, serialize(local), NOW);
    expect(plan.reason).toBe('already-agreed');
    expect(plan.publish).toBeNull();
    expect(plan.save).toBe(false);
  });

  it('publishes nothing when the remote agrees but lists records in another order', () => {
    // Two devices that merged from opposite directions hold the same ledger
    // in a different array order. Comparing raw JSON would call that a change
    // and start the ping-pong anyway.
    const local = store([txn('a', 100), txn('b', 100)]);
    const remote = store([txn('b', 100), txn('a', 100)]);
    expect(planSync(local, serialize(remote), NOW).publish).toBeNull();
  });

  it('publishes when we hold something the remote does not', () => {
    const local = store([txn('a', 100), txn('b', 200)]);
    const remote = store([txn('a', 100)]);
    const plan = planSync(local, serialize(remote), NOW);
    expect(plan.reason).toBe('merged');
    expect(plan.publish).not.toBeNull();
    expect(plan.save).toBe(false);        // nothing new arrived FOR us
  });

  it('saves when the remote holds something we do not', () => {
    const local = store([txn('a', 100)]);
    const remote = store([txn('a', 100), txn('b', 200)]);
    const plan = planSync(local, serialize(remote), NOW);
    expect(plan.save).toBe(true);
    expect(plan.store.txns).toHaveLength(2);
    expect(plan.publish).toBeNull();      // the remote is already correct
  });

  it('both saves and publishes when each side had news', () => {
    const plan = planSync(
      store([txn('a', 100), txn('mine', 300)]),
      serialize(store([txn('a', 100), txn('theirs', 300)])),
      NOW,
    );
    expect(plan.save).toBe(true);
    expect(plan.publish).not.toBeNull();
    expect(plan.store.txns.map((t) => t.id).sort()).toEqual(['a', 'mine', 'theirs']);
  });
});

describe('rule 3 — an unreadable remote is not authority', () => {
  for (const bad of ['{"v":2,"txns":[', 'null', '[]', '{"v":9,"txns":[]}', 'not json at all']) {
    it(`leaves the local ledger alone for ${JSON.stringify(bad.slice(0, 20))}`, () => {
      const local = store([txn('a', 100)]);
      const plan = planSync(local, bad, NOW);
      expect(plan.reason).toBe('unreadable-remote');
      expect(plan.store).toEqual(local);
      expect(plan.save).toBe(false);
      // Ours goes up: that is how a corrupt remote heals.
      expect(plan.publish).toBe(serialize(local));
    });
  }
});

describe('the loop settles', () => {
  it('two devices reach agreement and then go quiet', () => {
    // A real round: each has one record the other lacks.
    let phone = store([txn('p', 100, 'phone')]);
    let mac = store([txn('m', 200, 'mac')]);
    let cloud: string | null = null;

    // Six passes, alternating. The assertion is that it goes quiet, not just
    // that it converges — a converging loop that keeps publishing is still a
    // loop.
    const published: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const device = i % 2 === 0 ? phone : mac;
      const plan = planSync(device, cloud, NOW);
      if (plan.publish !== null) cloud = plan.publish;
      published.push(plan.publish !== null);
      if (i % 2 === 0) phone = plan.store; else mac = plan.store;
    }

    expect(phone.txns.map((t) => t.id).sort()).toEqual(['m', 'p']);
    expect(mac.txns.map((t) => t.id).sort()).toEqual(['m', 'p']);
    // The last two passes published nothing: the conversation ended.
    expect(published.slice(-2)).toEqual([false, false]);
  });

  it('a tombstone reaches the other device and stays dead', () => {
    // Timestamps NEAR now, deliberately. Written with small numbers this
    // failed, and correctly: prune drops a tombstone older than ninety days,
    // and `updated: 500` is 1970. Worth keeping in mind when writing any
    // fixture that survives a prune.
    const recent = NOW - 1000;
    const phone = store([txn('a', recent), txn('gone', recent)]);
    let cloud: string | null = serialize(phone);

    // The Mac deletes one.
    const macAfterDelete = store([txn('a', recent), txn('gone', NOW - 500, 'gone', true)]);
    const macPlan = planSync(macAfterDelete, cloud, NOW);
    cloud = macPlan.publish ?? cloud;

    // The phone hears about it.
    const phonePlan = planSync(phone, cloud, NOW);
    expect(phonePlan.save).toBe(true);
    expect(phonePlan.store.txns.find((t) => t.id === 'gone')?.deleted).toBe(true);

    // And the phone does NOT hand the record back on the next pass.
    const again = planSync(phonePlan.store, cloud, NOW);
    expect(again.publish).toBeNull();
  });
});
