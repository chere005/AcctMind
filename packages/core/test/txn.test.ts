/** Drafts, validation, and the arithmetic on top of a list. */
import { describe, expect, it } from 'vitest';
import {
  DESC_MAX, NAME_MAX, applyDraft, draftOf, duplicateTxn, emptyDraft, isValid, makeTxn,
  REORDER_GAP, SWIPE_CLAIM_PX, SWIPE_DELETE_PX, claimsSwipe, filterByName, newId,
  reorder, respace, sortTxns, swipeDeletes, total, txnText, validateDraft,
} from '../src/index';

/** The form always knows its account, so the test fixture supplies one too. */
const emptyDraft2 = (day: string) => emptyDraft(day, 'a1');
import type { Draft, Txn } from '../src/index';

const draft = (over: Partial<Draft> = {}): Draft => ({
  name: 'Coffee', description: 'flat white', amount: '4.50', date: '2026-08-20',
  account: 'a1', category: null, ...over,
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
    expect(validateDraft({
      name: '', description: '', amount: 'x', date: '', account: 'a1', category: null,
    }))
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
      amount: 450, date: '2026-08-20', account: 'a1', category: null, order: 0, created: 7,
      // A new record has never been edited: its merge clock starts at birth.
      updated: 7,
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
    expect(emptyDraft2('2026-08-20')).toEqual({
      name: '', description: '', amount: '', date: '2026-08-20',
      // The account is required rather than defaulted: the screen always
      // knows which section the + was pressed in.
      account: 'a1', category: null,
    });
  });
});

describe('total', () => {
  const t = (amount: number, id: string): Txn =>
    ({
      id, name: id, description: '', amount, date: '2026-08-20',
      account: 'a1', category: null, order: 0, created: 0, updated: 0,
    });

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

describe('the four things you can do to an existing transaction', () => {
  const base: Txn = {
    id: 'abc', name: 'Coffee', description: 'co-op', amount: -450,
    date: '2026-08-20', account: 'a1', category: null, order: 0, created: 1000, updated: 1000,
  };

  describe('edit', () => {
    it('round-trips through a draft without changing the amount', () => {
      // The trap this pins: the entry rules read bare digits as CENTS, so a
      // form seeded with '450' would come back as $4.50 having gone in as
      // -$4.50. `draftOf` writes the canonical '-4.50' for that reason.
      const back = applyDraft(base, draftOf(base), 2000);
      expect(back.amount).toBe(base.amount);
      expect(back.name).toBe(base.name);
      expect(back.date).toBe(base.date);
    });

    it('is the same transaction, edited — not a new one', () => {
      const edited = applyDraft(base, { ...draftOf(base), name: 'Tea' }, 2000);
      expect(edited.id).toBe(base.id);
      expect(edited.created).toBe(base.created);
      expect(edited.name).toBe('Tea');
    });

    it('moves the merge clock, so the edit beats every other copy', () => {
      expect(applyDraft(base, draftOf(base), 2000).updated).toBeGreaterThan(base.updated);
    });

    it('and still moves it when the clock has not', () => {
      // Same guarantee `touch` gives: two edits in one millisecond must not
      // tie, because a tie keeps the incumbent and drops the second.
      const once = applyDraft(base, draftOf(base), 1000);
      const twice = applyDraft(once, draftOf(once), 1000);
      expect(twice.updated).toBeGreaterThan(once.updated);
    });

    it('trims, exactly as making a new one does', () => {
      const e = applyDraft(base, { ...draftOf(base), name: '  Tea  ', description: '  x  ' }, 2000);
      expect(e.name).toBe('Tea');
      expect(e.description).toBe('x');
    });

    it('refuses a draft that has not been validated', () => {
      expect(() => applyDraft(base, { ...draftOf(base), amount: 'nope' }, 2000)).toThrow();
    });
  });

  describe('duplicate', () => {
    it('is a NEW transaction with the same details', () => {
      const copy = duplicateTxn(base, 'xyz', 5000);
      expect(copy.id).not.toBe(base.id);
      expect(copy.name).toBe(base.name);
      expect(copy.amount).toBe(base.amount);
      expect(copy.created).toBe(5000);
    });

    it('keeps the date rather than jumping to today', () => {
      // A date that quietly moved would be a wrong number in a ledger.
      expect(duplicateTxn(base, 'xyz', 5000).date).toBe(base.date);
    });

    it('carries no tombstone across', () => {
      // Duplicating a deleted row must not produce a dead one.
      const dead = { ...base, deleted: true as const };
      expect(duplicateTxn(dead, 'xyz', 5000).deleted).toBeUndefined();
    });
  });

  describe('copy', () => {
    it('copies what the row showed, not the raw cents', () => {
      expect(txnText(base)).toBe('2026-08-20\tCoffee\tco-op\t-$4.50');
    });

    it('is four fields whether or not there is a description', () => {
      // Tab-separated so it lands in a spreadsheet as cells. A missing
      // description must still leave its column, or the amount shifts left.
      expect(txnText({ ...base, description: '' }).split('\t')).toHaveLength(4);
    });
  });
});

describe('sorting and hand ordering', () => {
  const t = (id: string, over: Partial<Txn> = {}): Txn => ({
    id, name: id, description: '', amount: -100, date: '2026-08-20',
    account: 'a1', category: null, order: 0, created: 100, updated: 100, ...over,
  });

  it('defaults to date, newest first', () => {
    const rows = [t('old', { date: '2026-08-18' }), t('new', { date: '2026-08-20' })];
    expect(sortTxns(rows).map((r) => r.id)).toEqual(['new', 'old']);
    expect(sortTxns(rows, 'date').map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('orders by amount on the ABSOLUTE value', () => {
    // A ledger's biggest lines are worth seeing first whichever way the money
    // went. Sorted signed, the largest expense sinks below every small credit.
    const rows = [t('small', { amount: 100 }), t('bigOut', { amount: -50_000 }), t('mid', { amount: 900 })];
    expect(sortTxns(rows, 'amount').map((r) => r.id)).toEqual(['bigOut', 'mid', 'small']);
  });

  it('falls back to date when two amounts are equally large', () => {
    const rows = [
      t('a', { amount: -500, date: '2026-08-18' }),
      t('b', { amount: 500, date: '2026-08-20' }),
    ];
    expect(sortTxns(rows, 'amount').map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('custom looks exactly like date until something is dragged', () => {
    // What makes "custom remembers, and defaults to date" true on a device
    // that has never reordered anything.
    const rows = [t('old', { date: '2026-08-18' }), t('new', { date: '2026-08-20' })];
    expect(sortTxns(rows, 'custom').map((r) => r.id))
      .toEqual(sortTxns(rows, 'date').map((r) => r.id));
  });

  it('and honours a hand order once there is one', () => {
    const rows = [
      t('new', { date: '2026-08-20', order: 0 }),
      t('old', { date: '2026-08-18', order: REORDER_GAP }),
    ];
    expect(sortTxns(rows, 'custom').map((r) => r.id)).toEqual(['old', 'new']);
    // The other modes are unaffected: the drag changed the custom order only.
    expect(sortTxns(rows, 'date').map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('every mode is a TOTAL order, so two devices cannot disagree', () => {
    // Identical in every sortable field but the id.
    const rows = [t('b'), t('a'), t('c')];
    for (const mode of ['custom', 'date', 'amount'] as const) {
      expect(sortTxns(rows, mode).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    }
  });

  describe('reorder', () => {
    const shown = [t('x', { order: 300 }), t('y', { order: 200 }), t('z', { order: 100 })];

    it('moves one row and rewrites only that row', () => {
      const moved = reorder(shown, 'z', 0, 5000);
      expect(moved?.id).toBe('z');
      expect(moved?.order).toBeGreaterThan(300);
      // Re-sorting with the change applied puts it where it was dropped.
      const after = sortTxns(shown.map((r) => (r.id === 'z' ? moved! : r)), 'custom');
      expect(after.map((r) => r.id)).toEqual(['z', 'x', 'y']);
    });

    it('drops a row between two neighbours', () => {
      const moved = reorder(shown, 'x', 1, 5000);
      const after = sortTxns(shown.map((r) => (r.id === 'x' ? moved! : r)), 'custom');
      expect(after.map((r) => r.id)).toEqual(['y', 'x', 'z']);
    });

    it('costs nothing when the row lands where it started', () => {
      // No record, no clock bump, nothing to sync.
      expect(reorder(shown, 'x', 0, 5000)).toBeNull();
    });

    it('moves the merge clock, so the drag travels', () => {
      expect(reorder(shown, 'z', 0, 5000)?.updated).toBeGreaterThan(100);
    });

    it('shrugs at a row that is not there', () => {
      expect(reorder(shown, 'nope', 0, 5000)).toBeNull();
    });

    it('respace re-opens the gaps without changing the order', () => {
      // Repeated drops into one spot halve the gap; this is the way out.
      const tight = [t('a', { order: 2 }), t('b', { order: 1 }), t('c', { order: 0 })];
      const spaced = respace(tight, 5000);
      expect(sortTxns(spaced, 'custom').map((r) => r.id)).toEqual(['a', 'b', 'c']);
      const gaps = spaced.map((r) => r.order);
      expect(gaps[0]! - gaps[1]!).toBe(REORDER_GAP);
    });
  });
});

describe('filtering a picker', () => {
  const rows = [
    { name: 'Food & groceries' }, { name: 'Rent' }, { name: 'Transport' }, { name: '' },
  ];

  it('matches a substring, not just a prefix', () => {
    // The whole point: nobody types the beginning of "Food & groceries".
    expect(filterByName(rows, 'groc').map((r) => r.name)).toEqual(['Food & groceries']);
  });

  it('ignores case in both directions', () => {
    expect(filterByName(rows, 'RENT').map((r) => r.name)).toEqual(['Rent']);
    expect(filterByName([{ name: 'RENT' }], 'rent')).toHaveLength(1);
  });

  it('ignores surrounding space, which a paste brings with it', () => {
    expect(filterByName(rows, '  rent  ').map((r) => r.name)).toEqual(['Rent']);
  });

  it('an empty query is everything, not nothing', () => {
    expect(filterByName(rows, '')).toHaveLength(rows.length);
    expect(filterByName(rows, '   ')).toHaveLength(rows.length);
  });

  it('matches nothing when nothing matches', () => {
    expect(filterByName(rows, 'zzzz')).toEqual([]);
  });

  it('never matches an unnamed row on a real query', () => {
    // A category made and not yet named must not appear under every search.
    expect(filterByName(rows, 'a').some((r) => r.name === '')).toBe(false);
  });
});

describe('the swipe, as rules rather than as a gesture', () => {
  it('leaves a held finger alone', () => {
    // THE BUG THAT SHIPPED. A finger held still for 700ms drifts several
    // pixels; at a six-pixel threshold the swipe claimed the gesture and
    // cancelled every long press, so holding a row did nothing on a phone.
    for (const drift of [1, 3, 6, 8, 10, 13]) {
      expect(claimsSwipe(-drift, 1), `${drift}px of drift`).toBe(false);
      expect(claimsSwipe(-drift, -2), `${drift}px of drift`).toBe(false);
    }
  });

  it('claims a real swipe', () => {
    expect(claimsSwipe(-40, 2)).toBe(true);
    expect(claimsSwipe(-15, 0)).toBe(true);
  });

  it('never claims a rightward drag', () => {
    expect(claimsSwipe(40, 0)).toBe(false);
    expect(claimsSwipe(200, 1)).toBe(false);
  });

  it('leaves a SCROLL alone, however far it goes', () => {
    // Mostly vertical: the list has to stay scrollable.
    expect(claimsSwipe(-30, 90)).toBe(false);
    expect(claimsSwipe(-200, 400)).toBe(false);
  });

  it('deletes only past the line, and a half-swipe is a decision not to', () => {
    expect(swipeDeletes(-200)).toBe(true);
    expect(swipeDeletes(-97)).toBe(true);
    expect(swipeDeletes(-96)).toBe(false);
    expect(swipeDeletes(-40)).toBe(false);
    expect(swipeDeletes(0)).toBe(false);
    // And a rightward drag never deletes, whatever its size.
    expect(swipeDeletes(500)).toBe(false);
  });

  it('cannot be claimed and yet too short to matter', () => {
    // The claim distance must sit below the delete distance, or a swipe would
    // engage and then be incapable of ever completing.
    expect(SWIPE_CLAIM_PX).toBeLessThan(SWIPE_DELETE_PX);
  });
});
