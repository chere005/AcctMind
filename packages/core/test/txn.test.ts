/** Drafts, validation, and the arithmetic on top of a list. */
import { describe, expect, it } from 'vitest';
import {
  DESC_MAX, NAME_MAX, emptyDraft, isValid, makeTxn, newId, total, validateDraft,
} from '../src/index';
import type { Draft, Txn } from '../src/index';

const draft = (over: Partial<Draft> = {}): Draft => ({
  name: 'Coffee', description: 'flat white', amount: '4.50', date: '2026-08-20', ...over,
});

describe('validateDraft', () => {
  it('passes a good one', () => {
    expect(validateDraft(draft())).toEqual({});
    expect(isValid(validateDraft(draft()))).toBe(true);
  });

  it('requires a name that is more than whitespace', () => {
    expect(validateDraft(draft({ name: '' })).name).toBeDefined();
    expect(validateDraft(draft({ name: '   ' })).name).toBeDefined();
  });

  it('requires an amount, and one that parses', () => {
    expect(validateDraft(draft({ amount: '' })).amount).toBe('Amount is required');
    expect(validateDraft(draft({ amount: 'free' })).amount).toBe('That is not an amount');
    // The refusal that matters: too precise to store without inventing a cent.
    expect(validateDraft(draft({ amount: '1.005' })).amount).toBe('That is not an amount');
  });

  it('accepts zero and negative amounts', () => {
    // A ledger has both. Only unparseable is an error.
    for (const amount of ['0', '-4.50', '(4.50)']) {
      expect(validateDraft(draft({ amount })), amount).toEqual({});
    }
  });

  it('requires a real day', () => {
    for (const date of ['', '2026-13-01', '2026-02-30', 'today']) {
      expect(validateDraft(draft({ date })).date, date).toBe('Pick a date');
    }
  });

  it('does not require a description', () => {
    expect(validateDraft(draft({ description: '' }))).toEqual({});
  });

  it('has a ceiling on the free-text fields', () => {
    expect(validateDraft(draft({ name: 'x'.repeat(NAME_MAX) }))).toEqual({});
    expect(validateDraft(draft({ name: 'x'.repeat(NAME_MAX + 1) })).name).toBeDefined();
    expect(validateDraft(draft({ description: 'x'.repeat(DESC_MAX + 1) })).description).toBeDefined();
  });

  // Every field at once, so the form can show every field at once.
  it('reports all the bad fields together', () => {
    expect(validateDraft({ name: '', description: '', amount: 'x', date: '' }))
      .toEqual({
        name: 'Name is required',
        amount: 'That is not an amount',
        date: 'Pick a date',
      });
  });
});

describe('makeTxn', () => {
  it('trims the text and parses the amount', () => {
    const t = makeTxn(draft({ name: '  Coffee  ', description: '  hot  ', amount: ' $4.50 ' }), 'id1', 7);
    expect(t).toEqual({
      id: 'id1', name: 'Coffee', description: 'hot',
      amount: 450, date: '2026-08-20', created: 7,
    });
  });

  it('refuses a draft nobody validated', () => {
    // Loud, not silent: a screen that skipped validateDraft has a bug, and a
    // zero written into the ledger instead would be a wrong number nobody sees.
    expect(() => makeTxn(draft({ amount: 'free' }), 'id1', 7)).toThrow(/validated/);
  });
});

describe('emptyDraft', () => {
  it('is blank but dated', () => {
    expect(emptyDraft('2026-08-20')).toEqual({
      name: '', description: '', amount: '', date: '2026-08-20',
    });
  });
});

describe('total', () => {
  const t = (amount: number, id: string): Txn =>
    ({ id, name: id, description: '', amount, date: '2026-08-20', created: 0 });

  it('adds cents as integers', () => {
    expect(total([])).toBe(0);
    expect(total([t(1000, 'a'), t(-450, 'b'), t(1, 'c')])).toBe(551);
  });

  // The float bug, pinned. 0.1 + 0.2 !== 0.3, but 10 + 20 === 30 always.
  it('does not drift the way floats do', () => {
    const tenth = Array.from({ length: 10 }, (_, i) => t(10, String(i)));
    expect(total(tenth)).toBe(100);
    expect(total(Array.from({ length: 3 }, (_, i) => t(1, String(i))))).toBe(3);
  });
});

describe('newId', () => {
  it('sorts roughly by age and does not collide', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) ids.add(newId());
    expect(ids.size).toBe(2000);
    expect(newId(1000) < newId(2000)).toBe(true);
    // Across the width boundary base 36 grows a digit at — the case that
    // would have passed unpadded until roughly 2059 and then stopped.
    const boundary = Math.pow(36, 8);
    expect(newId(boundary - 1) < newId(boundary)).toBe(true);
    expect(newId(Date.now()) < newId(Date.now() + 1_000_000)).toBe(true);
  });

  it('is deterministic when its sources are', () => {
    const rand = () => 0.5;
    expect(newId(1000, rand)).toBe(newId(1000, rand));
  });
});
