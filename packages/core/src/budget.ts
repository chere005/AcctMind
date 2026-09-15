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

/**
 * How a budget line is READING right now, as one word.
 *
 * Sean, 2026-09-15: "any column that needs more money is yellow, negative is
 * red, positive is green", and a snoozed line "turns the column gray". So the
 * screen asks this rather than deciding for itself — four colours in a
 * component is four chances for the Mac and the phone to disagree about what
 * a yellow line means.
 *
 * The ORDER of the tests is the rule, not an implementation detail:
 *
 *   SNOOZED first, because it is a statement that this line is not asking for
 *   anything. A snoozed line that still painted yellow would be a snooze that
 *   does not snooze.
 *
 *   OVER next, and it beats short. Money already spent that you do not have
 *   is worse than money you have not assigned yet, and if a line is both, the
 *   overspend is the one to look at.
 *
 *   SHORT only when a target was actually SET. Zero means "no target", and
 *   painting every line without one yellow would make the colour mean
 *   nothing — most lines never get a target.
 */
export type LineTone = 'snoozed' | 'over' | 'short' | 'funded';

export function lineTone(
  line: { budget: number; needs: number; snoozed: boolean },
  spent: number,
): LineTone {
  if (line.snoozed) return 'snoozed';
  if (availableOf(line.budget, spent) < 0) return 'over';
  if (line.needs > 0 && line.budget < line.needs) return 'short';
  return 'funded';
}

/**
 * What is still to assign before a line meets its target, or 0.
 *
 * Never negative: a line funded past its target does not need minus money,
 * and returning a negative here would draw a "needs" figure that reads as a
 * debt when it is the opposite.
 */
export function stillNeeded(line: { budget: number; needs: number; snoozed: boolean }): number {
  if (line.snoozed || line.needs <= 0) return 0;
  return Math.max(0, line.needs - line.budget);
}

/**
 * The adjustment a reconcile writes.
 *
 * Sean, 2026-09-15: pressing the hammer turns the account's running total
 * into a field, and "after entering, if there was a difference, the
 * transaction gets made". This is that difference, and it is the whole rule —
 * what the account SHOULD hold, minus what the ledger currently says it does.
 *
 * Sign follows from that and needs no special case: a real balance HIGHER
 * than the ledger is money the ledger has not heard about, so the adjustment
 * is positive; lower, and it is negative. The same arithmetic covers both,
 * which is why there is no branch here to get backwards.
 *
 * Zero means no transaction. A reconcile that agrees with the ledger has
 * nothing to record, and writing a 0.00 row for it would put a permanent
 * mark in the register every time someone checked.
 */
export function reconcileAdjustment(ledgerTotal: number, statedTotal: number): number {
  return statedTotal - ledgerTotal;
}

/** What a reconcile's transaction is called, everywhere it is made. */
export const RECONCILE_NAME = 'Reconcile';
