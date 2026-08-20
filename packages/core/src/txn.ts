/** Making, checking and ordering transactions. The product's actual rules. */

import type { Draft, DraftErrors, Txn } from './types';
import { isDay } from './day';
import { parseAmount } from './money';

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
    created,
  };
}

/** A blank draft, dated today. What the + button opens. */
export function emptyDraft(day: string): Draft {
  return { name: '', description: '', amount: '', date: day };
}

/**
 * Newest first: by day, then by when it was entered, then by id.
 *
 * The id is the last key on purpose. Without it two transactions entered in
 * the same millisecond order themselves by whatever the input array happened
 * to be, so the list could reshuffle between renders — and, once anything
 * syncs, two devices holding identical data could disagree about the order.
 * A total order costs one comparison and removes both.
 */
export function sortTxns(txns: readonly Txn[]): Txn[] {
  return [...txns].sort((a, b) =>
    b.date.localeCompare(a.date)
    || b.created - a.created
    || a.id.localeCompare(b.id));
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
