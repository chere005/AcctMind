/**
 * Folding a whole LEVEL from one caret.
 *
 * Sean, 2026-09-16, across the whole suite: the top bar's collapse-all button
 * is gone, and a long press on any caret folds or unfolds every caret at its
 * level instead. The button was one control describing a hundred others from
 * the far side of the screen, it carried a toggle state you had to read
 * before you could predict it, and it could only ever mean ONE level —
 * Reminders and Notes have two, so their folders were never reachable from it
 * at all.
 *
 * The rule is small enough to write down and too easy to get subtly different
 * in six places, which is why it lives here rather than in each screen:
 *
 *   the direction is read off the caret that was HELD, not off the level.
 *
 * Hold an open one and the level closes; hold a closed one and it opens. So
 * "put this all away" is always the same gesture on whatever is still open,
 * and there is no all-or-nothing state to be out of step with what you see.
 * A level that is half folded has an obvious answer either way, which is what
 * the old `every(isFolded) ? expand : collapse` could not give: with one
 * section open out of nine, its button expanded the other eight.
 */

/**
 * The ids that should be folded after a caret at this level was held.
 *
 * `ids` is the level as it is DRAWN — a caller must not pass rows that are
 * filtered out of view, or folding leaves a surprise waiting behind the next
 * view switch. `wasOpen` is the held caret's own state.
 */
export function foldLevel(ids: readonly string[], wasOpen: boolean): string[] {
  return wasOpen ? [...ids] : [];
}

/**
 * How long a press has to be held, everywhere in the suite.
 *
 * One number, because a screen where two holds want different lengths of
 * patience is a screen where neither is learnable: the same 350 arms edit
 * mode on a row, opens a rename on a section name, and folds a level from a
 * caret.
 */
export const LONG_PRESS_MS = 350;
