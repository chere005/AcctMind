/**
 * Budget arithmetic: what was set aside, what actually moved, what is left.
 *
 * Three numbers per budget line, and only two of them are ever stored. The
 * third is derived, and WHICH two are stored is the whole design:
 *
 *   · BUDGETED is a decision a person makes. It is stored.
 *   · SPENT is the sum of the transactions filed against the line. It is
 *     derived from the ledger and is never edited directly — a budget screen
 *     that let you type over the money that actually moved would be a budget
 *     screen that lies.
 *   · AVAILABLE is budgeted plus spent. Derived.
 *
 * Sean, 2026-08-21: "you can edit either the amount available, or the amount
 * budgeted, and it will adjust the other value appropriately." Editing
 * AVAILABLE is therefore not a third stored number — it is a different way of
 * saying what BUDGETED should be, and `budgetFor` is that sentence read
 * backwards. Keeping one stored number and two views of it is what makes the
 * two edit paths incapable of disagreeing.
 *
 * Everything here is integer minor units, like the rest of the ledger. See
 * money.ts for why that is not negotiable.
 */
import { MAX_CENTS } from './money';

/**
 * What is left on a line: what was budgeted, PLUS what has moved.
 *
 * A sum, not a difference, and that is not a slip. Money out is NEGATIVE in
 * this ledger — a $30 expense is -3000 — so subtracting it would add it back.
 * Written as `budget - spent` this returns $130 of a $100 budget after
 * spending $30, which looks plausible enough on one line to survive a review
 * and is wrong on every line at once.
 *
 * It also means a refund does the right thing for free: a +$10 correction
 * filed against the line raises what is available, because that is what
 * actually happened to the money.
 */
export function availableOf(budget: number, spent: number): number {
  return budget + spent;
}

/**
 * The budget that would leave this much available, given what has moved.
 *
 * The exact inverse of `availableOf`, which `spec/budget.json` pins as a
 * round trip in both directions — that identity is the entire promise the
 * two-way edit makes, and a sign error in either function breaks it.
 */
export function budgetFor(available: number, spent: number): number {
  return available - spent;
}

/* ------------------------------------------------------------------ *
 * Typing into an amount that already has a value.
 *
 * Sean, 2026-08-21: tapping a budget field offers `=`, `+` and `-`. `=`
 * replaces, `+` adds what you type to what is there, `-` takes it away.
 *
 * Why an operator rather than just editing the number: a budget is adjusted
 * far more often than it is set. "Twenty more for groceries" is the actual
 * thought, and making someone read the current value, add twenty in their
 * head and type the total is asking them to do arithmetic the app is holding
 * all the inputs for — which is also the arithmetic they will get wrong.
 * ------------------------------------------------------------------ */

/** What the operator picker offers. */
export type AmountOp = '=' | '+' | '-';

export const AMOUNT_OPS: readonly AmountOp[] = ['=', '+', '-'];

/**
 * Apply a typed amount to the value already there.
 *
 * Returns null when the result is not a usable amount — the same refusal
 * money.ts makes, for the same reason: past `MAX_CENTS` the value stops being
 * exactly representable, and a budget that quietly loses precision is a
 * budget that cannot be explained. A refusal sends someone back to a field
 * they can see.
 *
 * NEGATIVE results are allowed, deliberately. Taking 50 off a budget of 20
 * leaves -30, and that is a true statement about an over-committed line;
 * clamping it to zero would hide the overspend, which is the one thing a
 * budget exists to show.
 */
export function applyOp(current: number, op: AmountOp, typed: number): number | null {
  const next = op === '=' ? typed : op === '+' ? current + typed : current - typed;
  if (!Number.isSafeInteger(next)) return null;
  if (Math.abs(next) > MAX_CENTS) return null;
  // The -0 guard money.ts explains: -0 is not 0 under Object.is and becomes 0
  // through JSON, so a value can change identity by being saved and loaded.
  return next === 0 ? 0 : next;
}
