/** Drafts, validation, and the arithmetic on top of a list. */
import { describe, expect, it } from 'vitest';
import {
  DESC_MAX, NAME_MAX, applyDraft, draftOf, duplicateTxn, emptyDraft, isValid, makeTxn,
  REORDER_GAP, SWIPE_CLAIM_PX, SWIPE_ARM_PX, claimsSwipe, filterByName, newId,
  clearedTotal, moveTxnTo, orderAbove, orderBetween, pickTap, reorder, respace, rowTap,
  selectedTotal, setCleared, sortTxns, swipeArms,
  toggleSelected, total,
  txnText, validateDraft,
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

  it('counts only what the bank has confirmed, for the cleared total', () => {
    const rows = [
      { ...t(1000, 'a'), cleared: true as const },
      t(-450, 'b'),
      { ...t(-100, 'c'), cleared: true as const },
    ];
    expect(clearedTotal(rows)).toBe(900);
    expect(total(rows)).toBe(450);
    expect(clearedTotal([])).toBe(0);
    // Nothing ticked is zero, not the total — the two figures are beside each
    // other on the account head and must never be able to read the same by
    // accident.
    expect(clearedTotal([t(1000, 'a')])).toBe(0);
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

    it('runs the other way for an ASCENDING list, at BOTH ends', () => {
      // The bug this argument exists for. Budget lines sort ascending — a
      // smaller order draws higher — and `orderBetween` was written for the
      // ledger, which is descending. So a line dropped at the TOP was given
      // `below + GAP`, the biggest number in the list, and went to the
      // bottom; a line dropped at the bottom went to the top. The MIDDLE is
      // a midpoint either way, which is why it looked like it worked.
      const asc = [t('x', { order: 100 }), t('y', { order: 200 }), t('z', { order: 300 })];
      const byAsc = (rows: typeof asc) => rows.slice().sort((a, b) => a.order - b.order);

      const toTop = reorder(asc, 'z', 0, 5000, 'asc');
      expect(toTop!.order).toBeLessThan(100);
      expect(byAsc(asc.map((r) => (r.id === 'z' ? toTop! : r))).map((r) => r.id))
        .toEqual(['z', 'x', 'y']);

      const toEnd = reorder(asc, 'x', 2, 5000, 'asc');
      expect(toEnd!.order).toBeGreaterThan(300);
      expect(byAsc(asc.map((r) => (r.id === 'x' ? toEnd! : r))).map((r) => r.id))
        .toEqual(['y', 'z', 'x']);
    });

    it('defaults to descending, so every ledger caller reads as it did', () => {
      const a = t('a', { order: 100 });
      expect(orderBetween(null, a)).toBe(orderBetween(null, a, 'desc'));
      expect(orderBetween(null, a)).toBeGreaterThan(100);
      expect(orderBetween(null, a, 'asc')).toBeLessThan(100);
      expect(orderBetween(a, null, 'asc')).toBeGreaterThan(100);
      // Between two, direction cannot matter: it is the midpoint.
      const b = t('b', { order: 200 });
      expect(orderBetween(b, a, 'asc')).toBe(orderBetween(b, a, 'desc'));
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
    expect(swipeArms(-200)).toBe(true);
    expect(swipeArms(-97)).toBe(true);
    expect(swipeArms(-96)).toBe(false);
    expect(swipeArms(-40)).toBe(false);
    expect(swipeArms(0)).toBe(false);
    // And a rightward drag never deletes, whatever its size.
    expect(swipeArms(500)).toBe(false);
  });

  it('cannot be claimed and yet too short to matter', () => {
    // The claim distance must sit below the delete distance, or a swipe would
    // engage and then be incapable of ever completing.
    expect(SWIPE_CLAIM_PX).toBeLessThan(SWIPE_ARM_PX);
  });
});

describe('what a tap means', () => {
  it('puts a parked delete away, whatever else was true', () => {
    // The point of the rule. Every other meaning a tap could have loses to
    // this one, or an armed delete becomes a state with no way out but the
    // delete itself.
    expect(rowTap(true, false)).toBe('dismiss');
    expect(rowTap(true, true)).toBe('dismiss');
  });

  it('picks in edit mode and edits in place otherwise', () => {
    expect(rowTap(false, true)).toBe('pick');
    expect(rowTap(false, false)).toBe('inline');
  });

  it('dismisses from a row that is not the swiped one', () => {
    // `parked` is about the LIST, not the row, so this is the same call —
    // which is exactly why a tap on any row puts the delete away.
    expect(rowTap(true, false)).not.toBe('inline');
  });
});

describe('pickTap — the selector dot', () => {
  it('picks, in edit mode and out of it', () => {
    // The dot is drawn on every row at all times (ChefMind's, 2026-09-21),
    // so it answers the same way whatever mode the page is in. If this ever
    // grew an `edit` argument, the dot would be lying about being always on.
    expect(pickTap(false)).toBe('pick');
  });

  it('still loses to a parked delete', () => {
    // The one case it shares with `rowTap`, and the reason both live in
    // core: an armed delete with no way out but the delete itself is the
    // state this app least wants, so EVERY target on the row dismisses it.
    expect(pickTap(true)).toBe('dismiss');
    expect(pickTap(true)).toBe(rowTap(true, false));
  });
});

describe('selecting several rows', () => {
  const t = (id: string, amount: number): Txn => ({
    id, name: id, description: '', amount, date: '2026-08-20',
    account: 'a1', category: null, order: 0, created: 1, updated: 1,
  });
  const rows = [t('a', -450), t('b', 240000), t('c', -185050)];

  it('toggles in and out', () => {
    expect(toggleSelected([], 'a')).toEqual(['a']);
    expect(toggleSelected(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleSelected(['a'], 'a')).toEqual([]);
  });

  it('does not add the same id twice', () => {
    // A double tap that both selected would leave a row that takes two taps
    // to clear and counts twice in the sum.
    expect(toggleSelected(['a'], 'a')).toEqual([]);
    expect(toggleSelected(toggleSelected([], 'a'), 'a')).toEqual([]);
  });

  it('sums what is selected, and nothing else', () => {
    expect(selectedTotal(rows, [])).toBe(0);
    expect(selectedTotal(rows, ['a'])).toBe(-450);
    expect(selectedTotal(rows, ['a', 'c'])).toBe(-185500);
    expect(selectedTotal(rows, ['a', 'b', 'c'])).toBe(54500);
  });

  it('skips an id whose row has gone', () => {
    // A row can be deleted on ANOTHER DEVICE while it sits selected here. It
    // must stop contributing rather than making the total wrong or throwing.
    expect(selectedTotal(rows, ['a', 'vanished'])).toBe(-450);
    expect(selectedTotal(rows, ['vanished'])).toBe(0);
    expect(selectedTotal([], ['a'])).toBe(0);
  });

  it('counts a row once however many times its id appears', () => {
    expect(selectedTotal(rows, ['a', 'a'])).toBe(-450);
  });
});

describe('setCleared', () => {
  // Sean, 2026-09-15: the cleared box at the far right of a transaction.
  const base: Txn = {
    id: 'a', name: 'Coffee', description: '', amount: -450, date: '2026-08-20',
    account: 'a1', category: null, order: 0, created: 1000, updated: 1000,
  };

  it('writes the literal true and moves the merge clock', () => {
    const on = setCleared(base, true, 5000);
    expect(on.cleared).toBe(true);
    expect(on.updated).toBe(5000);
  });

  it('clearing it REMOVES the key rather than writing false', () => {
    // An uncleared row must be byte-identical to one written before the
    // field existed: `false` would be a new shape for every old store.
    const off = setCleared(setCleared(base, true, 5000), false, 6000);
    expect('cleared' in off).toBe(false);
    expect(off.updated).toBe(6000);
    expect(JSON.stringify(off)).toBe(JSON.stringify({ ...base, updated: 6000 }));
  });

  it('a duplicate has not been on any statement', () => {
    const dup = duplicateTxn(setCleared(base, true, 5000), 'b', 7000);
    expect('cleared' in dup).toBe(false);
  });
});

describe('orderAbove — a drop that names the row it landed on', () => {
  const t2 = (id: string, order: number, account = 'a1'): Txn => ({
    id, name: id, description: '', amount: -100, date: '2026-08-20',
    account, category: null, order, created: 1, updated: 1,
  });
  const into = [t2('x', 300), t2('y', 200), t2('z', 100)];

  it('puts a row above the one it names', () => {
    expect(orderAbove(into, 'new', 'y', 'desc')).toBe(250);
  });

  it('reads a null beforeId as the END of the list', () => {
    expect(orderAbove(into, 'new', null, 'desc')).toBeLessThan(100);
  });

  it('reads an id that is no longer there as the end too', () => {
    // The row it was aimed at was deleted on another device mid-drag. The
    // end is the only honest answer left, and it must not throw.
    expect(orderAbove(into, 'new', 'gone', 'desc')).toBe(orderAbove(into, 'new', null, 'desc'));
  });

  it('leaves a row already on that boundary exactly where it is', () => {
    // `y` is already directly above `z`, so this drop asks for nothing. It
    // must come back with y's OWN order — not a fresh midpoint that would
    // rewrite the record, move its merge clock and sync for no reason.
    expect(orderAbove(into, 'y', 'z', 'desc')).toBe(200);
  });

  it('fills the gap the mover is LEAVING, when the row it named has gone', () => {
    // The two rules meeting: the id was deleted on another device mid-drag,
    // so the drop means the end of the list — and the end is measured with
    // the mover taken OUT, because it is no longer sitting there.
    // Reading it with `z` still in place would give a slot below `z`, which
    // is the position the row is vacating.
    expect(orderAbove(into, 'z', 'gone', 'desc'))
      .toBe(orderAbove([into[0]!, into[1]!], 'z', null, 'desc'));
    // A clear step below `y`, the last row that is STAYING — not below the
    // 100 that `z` is carrying out of the list with it.
    expect(orderAbove(into, 'z', 'gone', 'desc')).toBe(200 - REORDER_GAP);
  });

  it('takes an empty destination', () => {
    expect(orderAbove([], 'new', null, 'desc')).toBe(0);
  });
});

describe('moveTxnTo — a row dragged into another ACCOUNT', () => {
  const t2 = (id: string, order: number, account: string): Txn => ({
    id, name: id, description: '', amount: -100, date: '2026-08-20',
    account, category: null, order, created: 1, updated: 1,
  });
  const all = [t2('a1x', 300, 'A'), t2('a1y', 200, 'A'), t2('b1', 100, 'B')];

  it('re-files the row and orders it where it was dropped', () => {
    const moved = moveTxnTo(all, all[0]!, 'B', 'b1', 5000);
    expect(moved?.account).toBe('B');
    expect(moved?.order).toBeGreaterThan(100);
    expect(moved?.updated).toBe(5000);
  });

  it('lands at the end of the destination when nothing is named', () => {
    const moved = moveTxnTo(all, all[0]!, 'B', null, 5000);
    expect(moved?.account).toBe('B');
    expect(moved?.order).toBeLessThan(100);
  });

  it('takes an EMPTY account', () => {
    const moved = moveTxnTo(all, all[0]!, 'C', null, 5000);
    expect(moved?.account).toBe('C');
    expect(moved?.order).toBe(0);
  });

  it('costs nothing when the row lands exactly where it was', () => {
    // Same account, same slot: no record, no merge clock, nothing to sync.
    expect(moveTxnTo(all, all[1]!, 'A', null, 5000)).toBeNull();
  });

  it('never measures the mover against itself', () => {
    // Dropped above the row that currently follows it — which is where it
    // already is. Without filtering the mover out, `a1x` would be measured
    // between itself and `a1y` and come back with a pointless new order.
    expect(moveTxnTo(all, all[0]!, 'A', 'a1y', 5000)).toBeNull();
  });
});
