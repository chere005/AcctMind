/**
 * The pairing code, and the exchange it opens.
 *
 * `spec/pair.json` is replayed here rather than in `spec.test.ts` for the
 * same reason `spec/merge.json` is replayed in its own file: the vectors are
 * about one module and read better next to the properties that back them up.
 *
 * The two exhaustive tests below are the ones worth having. Example-based
 * checksum tests prove that a checksum exists; these prove what it CATCHES,
 * over every single-character mistake and every adjacent swap that can be
 * made to a real code. That is the claim the pairing screen makes to a
 * person when it says "that code has a typo in it".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PAIR_ALPHABET, PAIR_DATA_CHARS, PAIR_GROUP, PAIR_SECRET_BYTES, PEER_MAX_BYTES,
  STORE_VERSION, formatPairCode, parsePairCode, planSync, serialize,
} from '../src/index';
import type { Store, Txn } from '../src/index';

const spec = JSON.parse(
  readFileSync(new URL('../../../spec/pair.json', import.meta.url), 'utf8'),
) as {
  codes: [string, string][];
  accepts: [string, string][];
  rejects: [string, string][];
};

describe('spec/pair.json — the codes', () => {
  it('renders each secret as the code in the contract', () => {
    for (const [hex, code] of spec.codes) {
      expect(formatPairCode(hex), hex).toBe(code);
    }
  });

  it('reads each of them back to the same secret', () => {
    for (const [hex, code] of spec.codes) {
      const r = parsePairCode(code);
      expect(r.ok, code).toBe(true);
      if (r.ok) expect(r.secretHex).toBe(hex);
    }
  });
});

describe('spec/pair.json — what a person may type', () => {
  const want = spec.codes[3]?.[0];

  for (const [typed, why] of spec.accepts) {
    it(`accepts it ${why}`, () => {
      const r = parsePairCode(typed);
      expect(r.ok, typed).toBe(true);
      if (r.ok) expect(r.secretHex).toBe(want);
    });
  }

  for (const [typed, why] of spec.rejects) {
    it(`refuses it: ${why}`, () => {
      const r = parsePairCode(typed);
      expect(r.ok, typed).toBe(false);
      // Every refusal has something to show a person. A silent false would
      // leave the pairing screen with nothing to say.
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    });
  }
});

describe('the check character', () => {
  // Derived from the implementation under test, NOT written down here. A
  // hard-coded code is only valid while the checksum is the one that made
  // it: change the algorithm and the literal stops parsing, every mutation
  // of it is refused for the wrong reason, and the test passes while
  // proving nothing. That is not hypothetical — this file had it, and
  // replacing Luhn with a plain sum left "catches every adjacent
  // transposition" green.
  const bare = formatPairCode('8f3a1c04d5e6970b2a48c1de3f5079').replace(/-/g, '');

  it('accepts the code it just made — the guard on the two tests below', () => {
    expect(parsePairCode(bare).ok).toBe(true);
  });

  it('catches EVERY single-character mistake', () => {
    let tried = 0;
    const missed: string[] = [];
    for (let i = 0; i < bare.length; i++) {
      for (const ch of PAIR_ALPHABET) {
        if (ch === bare.charAt(i)) continue;
        tried++;
        const typo = bare.slice(0, i) + ch + bare.slice(i + 1);
        if (parsePairCode(typo).ok) missed.push(typo);
      }
    }
    // Every position x every other character in the alphabet.
    expect(tried).toBe((PAIR_DATA_CHARS + 1) * (PAIR_ALPHABET.length - 1));
    expect(missed).toEqual([]);
  });

  it('catches every adjacent transposition', () => {
    const missed: string[] = [];
    let tried = 0;
    for (let i = 0; i < bare.length - 1; i++) {
      // Swapping a character with its twin is not a mistake anyone can make.
      if (bare.charAt(i) === bare.charAt(i + 1)) continue;
      tried++;
      const swapped = bare.slice(0, i) + bare.charAt(i + 1) + bare.charAt(i) + bare.slice(i + 2);
      if (parsePairCode(swapped).ok) missed.push(swapped);
    }
    expect(tried).toBeGreaterThan(20);
    expect(missed).toEqual([]);
  });
});

describe('the shape of a code', () => {
  it('carries 120 bits — the whole security of the link', () => {
    // If this number ever goes down, someone who recorded one handshake off
    // the wifi can grind the secret out of it offline. It is not a UX knob.
    expect(PAIR_SECRET_BYTES * 8).toBe(120);
    expect(PAIR_DATA_CHARS * Math.log2(PAIR_ALPHABET.length)).toBe(120);
  });

  it('has no confusable characters in it', () => {
    expect(PAIR_ALPHABET).not.toMatch(/[ILOU]/);
    expect(new Set(PAIR_ALPHABET).size).toBe(PAIR_ALPHABET.length);
  });

  it('is grouped for reading off a screen', () => {
    const code = formatPairCode('8f3a1c04d5e6970b2a48c1de3f5079');
    expect(code.split('-').every((g) => g.length === PAIR_GROUP)).toBe(true);
    expect(code.replace(/-/g, '')).toHaveLength(PAIR_DATA_CHARS + 1);
  });

  it('refuses a secret that is not the right size, rather than padding one', () => {
    expect(() => formatPairCode('00')).toThrow();
    expect(() => formatPairCode('8f3a1c04d5e6970b2a48c1de3f50')).toThrow();
    expect(() => formatPairCode('zz3a1c04d5e6970b2a48c1de3f5079')).toThrow();
  });
});

describe('the exchange over a socket', () => {
  // The same planner iCloud uses. The point of these tests is that the peer
  // path is pinned SEPARATELY, so a change made for iCloud's sake cannot
  // quietly alter what two devices say to each other on a wifi network.
  const txn = (id: string, updated: number): Txn => ({
    id, name: id, description: '', amount: 100, date: '2026-08-20', created: 1, updated,
    account: 'a1', category: null, order: 0,
  });
  const ACCT = {
    id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 0, updated: 0,
  };
  const store = (txns: Txn[]): Store =>
    ({ v: STORE_VERSION, txns, accounts: [ACCT], categories: [] });
  const NOW = 2_000_000_000_000;

  it('settles in two rounds and then stops talking', () => {
    let phone = store([txn('p', 100)]);
    let mac = store([txn('m', 200)]);

    // Round 1: the phone opens with its ledger. The Mac answers only because
    // it has news; if it answered regardless, the two would trade frames for
    // as long as they stayed on the same network.
    const macPlan = planSync(mac, serialize(phone), NOW);
    mac = macPlan.store;
    expect(macPlan.publish).not.toBeNull();

    // Round 2: the phone takes the answer, and has nothing left to add.
    const phonePlan = planSync(phone, macPlan.publish, NOW);
    phone = phonePlan.store;
    expect(phonePlan.save).toBe(true);
    expect(phonePlan.publish).toBeNull();

    expect(phone.txns.map((t) => t.id).sort()).toEqual(['m', 'p']);
    expect(mac.txns.map((t) => t.id).sort()).toEqual(['m', 'p']);
  });

  it('answers a peer talking nonsense with the truth, and keeps its own', () => {
    // Anything can connect to a socket on a wifi network. A frame that will
    // not parse must not touch this device's ledger.
    const mine = store([txn('a', 100)]);
    const plan = planSync(mine, '{"v":2,"txns":[', NOW);
    expect(plan.store).toEqual(mine);
    expect(plan.save).toBe(false);
    expect(plan.publish).toBe(serialize(mine));
  });

  it('caps a frame well below anything that hurts, and above anything real', () => {
    // ~120 bytes a row: the cap is tens of thousands of transactions.
    expect(PEER_MAX_BYTES / 120).toBeGreaterThan(30_000);
    expect(PEER_MAX_BYTES).toBeLessThan(8 * 1024 * 1024);
  });
});
