import { describe, expect, it } from 'vitest';
import { LONG_PRESS_MS, foldLevel } from '../src/folds';

/**
 * The rule a HELD caret follows, which replaced the collapse-all button
 * across the suite on 2026-09-16. It is four lines of code and it lives in
 * core for one reason: six screens used to decide it for themselves, and the
 * way they decided it was wrong in a case nobody had named.
 */
describe('foldLevel', () => {
  it('closes the level when the held caret was open', () => {
    expect(foldLevel(['a', 'b', 'c'], true)).toEqual(['a', 'b', 'c']);
  });

  it('opens the level when the held caret was closed', () => {
    expect(foldLevel(['a', 'b', 'c'], false)).toEqual([]);
  });

  /**
   * THE CASE THE OLD BUTTON GOT WRONG, and the reason the direction is read
   * off the held caret rather than off the level.
   *
   * `allCollapsed ? expand : collapse` asks "is every one of them shut?", so
   * with eight sections shut and one open it answered "no" and collapsed —
   * fine. But with eight OPEN and one shut it also answered "no" and
   * collapsed, which is right, while with every one shut but a single row
   * left open by a grace timer it expanded all nine. The gesture cannot be
   * wrong that way: whatever you are holding is the answer.
   */
  it('reads the direction from the held caret, not from the rest of the level', () => {
    const level = ['a', 'b', 'c'];
    // Holding the one still-open caret in a mostly-folded level CLOSES it —
    // the old button would have expanded the other two.
    expect(foldLevel(level, true)).toEqual(level);
    // Holding a folded one in a mostly-open level OPENS the level.
    expect(foldLevel(level, false)).toEqual([]);
  });

  it('never returns the array it was handed, so a caller cannot mutate the level', () => {
    const ids = ['a', 'b'];
    const out = foldLevel(ids, true);
    expect(out).not.toBe(ids);
    out.push('c');
    expect(ids).toEqual(['a', 'b']);
  });

  it('has nothing to fold in an empty level', () => {
    expect(foldLevel([], true)).toEqual([]);
    expect(foldLevel([], false)).toEqual([]);
  });

  it('holds one threshold for every press in the suite', () => {
    expect(LONG_PRESS_MS).toBe(350);
  });
});
