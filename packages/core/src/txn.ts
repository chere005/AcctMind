/** Making, checking and ordering transactions. The product's actual rules. */

import type { Draft, DraftErrors, Txn } from './types';
import { isDay } from './day';
import { amountInput, formatAmount, parseAmount } from './money';
import { touch } from './merge';

export const NAME_MAX = 120;
export const DESC_MAX = 2000;

/**
 * Check a draft. Returns one message per bad field, and `{}` when it is fine.
 *
 * Returning the errors rather than throwing is what lets the add form show
 * all of them at once. A validator that throws on the first problem makes a
 * person fix their input one round trip at a time.
 */
export function validateDraft(draft: Draft): DraftErrors {
  const errors: DraftErrors = {};

  const name = draft.name.trim();
  if (name === '') errors.name = 'Name is required';
  else if (name.length > NAME_MAX) errors.name = `Name is longer than ${NAME_MAX} characters`;

  if (draft.description.length > DESC_MAX) {
    errors.description = `Description is longer than ${DESC_MAX} characters`;
  }

  if (draft.amount.trim() === '') errors.amount = 'Amount is required';
  else if (parseAmount(draft.amount) === null) errors.amount = 'That is not an amount';

  if (!isDay(draft.date)) errors.date = 'Pick a date';

  if (draft.account.trim() === '') errors.account = 'Pick an account';

  return errors;
}

/** True when `validateDraft` found nothing. */
export function isValid(errors: DraftErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Build a transaction from a draft that has already passed validation.
 *
 * `id` and `created` are arguments rather than generated in here so that a
 * test can pin them and get the same object twice. The screens call
 * `newId()` and `Date.now()` themselves — the impurity lives at the edge.
 */
export function makeTxn(draft: Draft, id: string, created: number): Txn {
  const amount = parseAmount(draft.amount);
  if (amount === null) throw new Error('makeTxn: the draft has not been validated');
  return {
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    amount,
    date: draft.date,
    account: draft.account,
    category: draft.category,
    // A new row has never been dragged. Zero means "use the date order",
    // which is what makes an untouched list identical in every sort mode.
    order: 0,
    created,
    // A new record has never been edited, so its merge clock starts where it
    // was born. Every later change goes through `touch`.
    updated: created,
  };
}

/** A blank draft, dated today. What the + button opens. */
export function emptyDraft(day: string, account: string, category: string | null = null): Draft {
  // The account is required rather than defaulted. A form that invented one
  // would put transactions somewhere nobody chose, and the screen always
  // knows which section the + was pressed in.
  //
  // The category is OPTIONAL and defaults to none, because most + presses
  // happen on an account and say nothing about a category. Budget's own + is
  // the case that does know one: pressing + beside Groceries means this is a
  // Groceries transaction, and making someone pick it again from a dropdown
  // is asking a question they have already answered.
  return { name: '', description: '', amount: '', date: day, account, category };
}

/* ------------------------------------------------------------------ *
 * Choosing several rows at once.
 *
 * Sean, 2026-08-21: "in edit mode allow for selecting multiple
 * transactions.. when multiple transactions are selected, show the sum of
 * their amounts." Which is the whole point of it — "what did this weekend
 * cost" is a question a ledger should answer by tapping four rows, not by
 * adding them up by hand.
 * ------------------------------------------------------------------ */

/** Add an id to the selection, or take it out. */
export function toggleSelected(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * The sum of the selected rows, in cents.
 *
 * Ids that no longer name a transaction are SKIPPED rather than counted as
 * zero or thrown over — a row can be deleted on another device while it sits
 * selected here, and a selection that outlives its row must not make the
 * total wrong or the screen crash. It just stops contributing.
 */
export function selectedTotal(txns: readonly Txn[], ids: readonly string[]): number {
  const want = new Set(ids);
  return txns.reduce((sum, t) => (want.has(t.id) ? sum + t.amount : sum), 0);
}

/** The sum, in cents. Integers throughout — see money.ts. */
export function total(txns: readonly Txn[]): number {
  return txns.reduce((sum, t) => sum + t.amount, 0);
}

/** Base-36 milliseconds, zero-padded — see `newId`. */
const TIME_WIDTH = 9;

/**
 * A fresh id: milliseconds in base 36, then randomness.
 *
 * Not `crypto.randomUUID()` — it is absent on some Hermes builds, and an id
 * generator that throws on one of six surfaces is found by a person, not a
 * test.
 *
 * The time prefix is PADDED to a fixed width, and that padding is the whole
 * point: base 36 only sorts lexicographically when every string is the same
 * length. Unpadded, `newId(1000)` is 'rs' and `newId(2000)` is '1jk', so the
 * later id sorts first. Today's timestamps are all 8 characters so it would
 * have looked correct for another thirty years and then quietly stopped — the
 * kind of bug that ships. Nine characters covers every millisecond up to the
 * year 5188, and ids are compared as strings everywhere they are compared.
 */
export function newId(now: number = Date.now(), rand: () => number = Math.random): string {
  let tail = '';
  for (let i = 0; i < 8; i++) tail += Math.floor(rand() * 36).toString(36);
  return now.toString(36).padStart(TIME_WIDTH, '0') + '-' + tail;
}

/* ------------------------------------------------------------------ *
 * The four things you can do to a transaction that already exists.
 *
 * A row is held down and offers, right to left: delete, copy, duplicate,
 * edit. Delete is the destructive one and sits furthest from the thumb's
 * resting place on the left, which is where `edit` — the one people reach
 * for most — goes instead.
 *
 * Everything here is pure and takes its clock and its ids as arguments, for
 * the same reason `makeTxn` does: a test can pin both and get the same object
 * twice.
 * ------------------------------------------------------------------ */

/**
 * A transaction as an editable draft — the inverse of `makeTxn`.
 *
 * The amount goes back through `amountInput`, so what lands in the field is
 * the canonical `-4.50` rather than the raw digits somebody once typed. A
 * form seeded with `1234` would read as $12.34 under the entry rules and
 * silently divide the amount by a hundred on the way in.
 */
export function draftOf(txn: Txn): Draft {
  return {
    name: txn.name,
    description: txn.description,
    amount: amountInput(txn.amount),
    date: txn.date,
    account: txn.account,
    category: txn.category,
  };
}

/**
 * Apply an edited draft to an existing transaction.
 *
 * Keeps `id` and `created` — it is the same transaction, edited, not a new
 * one — and moves the merge clock through `touch` so the edit outranks the
 * copy on every other device. `created` staying put is what keeps the list
 * order stable under an edit that does not change the date.
 */
export function applyDraft(txn: Txn, draft: Draft, now: number): Txn {
  const amount = parseAmount(draft.amount);
  if (amount === null) throw new Error('applyDraft: the draft has not been validated');
  return touch({
    ...txn,
    name: draft.name.trim(),
    description: draft.description.trim(),
    amount,
    date: draft.date,
    account: draft.account,
    category: draft.category,
  }, now);
}

/**
 * A second transaction with the same details.
 *
 * A NEW id and a new `created`, because it is a new transaction — the point
 * of duplicating is a second coffee, not a second copy of the first one.
 * Anything else would make the two indistinguishable to the merge, and a
 * duplicate that shared an id would be silently swallowed by it.
 *
 * The DATE is carried over rather than reset to today. Someone duplicating a
 * row is usually entering something that already happened alongside it; a
 * date that quietly jumped would be a wrong number in the ledger, and it is
 * one tap to change.
 */
export function duplicateTxn(txn: Txn, id: string, now: number): Txn {
  return {
    id,
    name: txn.name,
    description: txn.description,
    amount: txn.amount,
    date: txn.date,
    account: txn.account,
    category: txn.category,
    // Not the original's place in a hand-made order: it is a new row, and
    // inheriting the position would put two rows in one slot.
    order: 0,
    created: now,
    updated: now,
  };
}

/**
 * A transaction as text, for the clipboard.
 *
 * Tab-separated so it lands in a spreadsheet as four cells, and readable as
 * a line if it does not. The amount is `formatAmount`, the same string the
 * row shows — what is copied is what was on screen.
 */
export function txnText(txn: Txn): string {
  return [txn.date, txn.name, txn.description, formatAmount(txn.amount)].join('\t');
}

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

/** How the list is ordered. A view choice, so it lives in device prefs. */
export type SortMode = 'custom' | 'date' | 'amount';

/**
 * The gap left between neighbours when order is assigned.
 *
 * Sparse on purpose. Dropping a row between two others takes the midpoint of
 * their orders, so one row is rewritten rather than every row after it — and
 * every rewrite is a merge-clock bump that has to cross a network. With a
 * gap of 1024 a list can be rearranged about ten times in the same spot
 * before the midpoints collide and `respace` is needed.
 */
export const REORDER_GAP = 1024;

/**
 * Order by date, newest first — the default, and the tiebreak for the others.
 *
 * The id key exists so the order is TOTAL: without it two rows entered in the
 * same millisecond order themselves by input order, which reshuffles between
 * renders and lets two devices disagree about a list they both hold.
 */
function byDate(a: Txn, b: Txn): number {
  return b.date.localeCompare(a.date) || b.created - a.created || a.id.localeCompare(b.id);
}

/**
 * The list, in the order asked for.
 *
 * `amount` compares ABSOLUTE values: a ledger's biggest lines are the ones
 * worth seeing first whichever direction the money went, and sorting signed
 * would bury the largest expense at the bottom under every small credit.
 *
 * `custom` falls back to the date order for any row that has never been
 * dragged, which is what makes "custom remembers" true from the first launch:
 * an untouched list in custom mode looks exactly like the date one.
 */
export function sortTxns(txns: readonly Txn[], mode: SortMode = 'date'): Txn[] {
  const rows = [...txns];
  if (mode === 'amount') {
    return rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || byDate(a, b));
  }
  if (mode === 'custom') {
    // Rows never dragged carry order 0 and are separated by the date rule, so
    // a fresh ledger in custom mode is the date ledger until something moves.
    return rows.sort((a, b) => b.order - a.order || byDate(a, b));
  }
  return rows.sort(byDate);
}

/**
 * The order value that puts a row between two neighbours.
 *
 * `null` for an end of the list. Returns the midpoint, or a clear step beyond
 * the edge — never an average with a missing side, which is how a dragged row
 * ends up at zero and jumps somewhere nobody asked for.
 */
export function orderBetween(above: Txn | null, below: Txn | null): number {
  if (above === null && below === null) return 0;
  if (above === null) return (below?.order ?? 0) + REORDER_GAP;
  if (below === null) return above.order - REORDER_GAP;
  return (above.order + below.order) / 2;
}

/**
 * Move `id` to sit at `index` in the list as currently shown.
 *
 * Takes the VISIBLE list, because a drag is a statement about what is on
 * screen: the person moved a row below the one they can see, not below
 * whatever the raw array happens to hold next.
 *
 * Returns only the row that changed, or null when nothing needs to move —
 * so a drag that ends where it started costs no merge clock and no sync.
 */
export function reorder(shown: readonly Txn[], id: string, index: number, now: number): Txn | null {
  const from = shown.findIndex((t) => t.id === id);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(shown.length - 1, index));
  if (from === to) return null;
  const without = shown.filter((t) => t.id !== id);
  const above = without[to - 1] ?? null;
  const below = without[to] ?? null;
  const moved = shown[from];
  if (moved === undefined) return null;
  const order = orderBetween(above, below);
  if (order === moved.order) return null;
  return touch({ ...moved, order }, now);
}

/**
 * Give every row a fresh, evenly spaced order in the order currently shown.
 *
 * Needed when repeated drags into one spot have halved the gap to nothing.
 * Rewrites everything, so it is a last resort rather than a routine step —
 * every row it touches is a row that has to travel.
 */
export function respace(shown: readonly Txn[], now: number): Txn[] {
  const n = shown.length;
  return shown.map((t, i) => touch({ ...t, order: (n - i) * REORDER_GAP }, now));
}

/**
 * The categories matching what someone has typed into the picker.
 *
 * A SUBSTRING match, case-insensitive, because people remember "groceries"
 * out of "Food & groceries" — a prefix match would hide the thing they are
 * looking for and look broken. An empty query is everything, not nothing.
 *
 * In core rather than in the picker because it is a rule stated in a
 * sentence, and it was in the component first: the screen was the only place
 * that knew it, so the only way to test it was to drive a dropdown, and the
 * only place it could be wrong was somewhere no unit test could see.
 */
export function filterByName<R extends { name: string }>(rows: readonly R[], query: string): R[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...rows];
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

/* ------------------------------------------------------------------ *
 * The swipe
 *
 * Thresholds and the two decisions made from them, in core rather than in a
 * gesture handler — they are rules stated in a sentence, and leaving them in
 * the component meant the only way to test them was to drive a finger, which
 * the browser harness cannot do. Three attempts at that produced tests that
 * passed because NOTHING happened, which is the worst kind.
 * ------------------------------------------------------------------ */

/**
 * How far a horizontal drag must go before the row is claimed as a swipe.
 *
 * Fourteen, not six. At six this stole the LONG PRESS on real hardware: a
 * finger held still for 700ms drifts further than that, so the responder took
 * the gesture and the press was cancelled — holding a row did nothing on a
 * phone while every browser test passed, because a mouse does not drift.
 */
export const SWIPE_CLAIM_PX = 14;

/** How far it must travel before letting go arms the delete. */
export const SWIPE_ARM_PX = 96;

/**
 * Should this movement be taken as a swipe rather than left alone?
 *
 * Left only, past the claim distance, and decisively more horizontal than
 * vertical — a list that claims every touch cannot be scrolled, and one that
 * claims a wobble cannot be held.
 */
export function claimsSwipe(dx: number, dy: number): boolean {
  return dx < -SWIPE_CLAIM_PX && Math.abs(dx) > Math.abs(dy) * 2.5;
}

/**
 * Does letting go here ARM the delete, or come to nothing?
 *
 * It was `swipeDeletes`, and the swipe deleted the row outright. Sean,
 * 2026-08-21: a swipe should bring up a delete BUTTON. So the gesture no
 * longer destroys anything — it parks a control that does, and one more tap
 * is what actually deletes.
 *
 * Renamed rather than left alone, because a function still called
 * `swipeDeletes` that no longer deletes is the exact drift between a name and
 * its behaviour that this repo has been bitten by before.
 */
export function swipeArms(dx: number): boolean {
  return dx < -SWIPE_ARM_PX;
}
