/**
 * Moving a budget line to another CATEGORY.
 *
 * Sean, 2026-09-21: "make it possible to drag items between sections and
 * folders in budget." A category is the Budget tab's section, and until now
 * a line could only be dragged among its siblings — each category owned its
 * own drag and the question could not be asked.
 *
 * The ordering half is `orderAbove`'s (txn.test.ts) and the "which section,
 * above which row" half is `rowslots.ts`'s (rowslots.test.ts). What is left
 * here is the join between them, and the one claim that is this app's alone:
 * the MONEY does not follow the line anywhere.
 */
import { describe, expect, it } from 'vitest';
import { linesIn, moveLineTo } from '../src/index';
import type { Line } from '../src/index';

const line = (id: string, category: string, order: number, over: Partial<Line> = {}): Line => ({
  id, name: id, category, budget: 0, needs: 0, snoozed: false,
  order, created: 1, updated: 1, ...over,
});

describe('linesIn', () => {
  const all = [line('b', 'A', 20), line('a', 'A', 10), line('x', 'B', 5)];

  it('keeps one category, ASCENDING — the way the tab draws them', () => {
    expect(linesIn(all, 'A').map((l) => l.id)).toEqual(['a', 'b']);
    expect(linesIn(all, 'B').map((l) => l.id)).toEqual(['x']);
  });

  it('never mutates the list it is given', () => {
    linesIn(all, 'A');
    expect(all.map((l) => l.id)).toEqual(['b', 'a', 'x']);
  });

  it('answers an unknown category with nothing rather than throwing', () => {
    expect(linesIn(all, 'gone')).toEqual([]);
  });
});

describe('moveLineTo', () => {
  const all = [line('a1', 'A', 10), line('a2', 'A', 20), line('b1', 'B', 10)];

  it('re-files the line and puts it above the row it was dropped on', () => {
    const moved = moveLineTo(all, all[0]!, 'B', 'b1', 5000);
    expect(moved?.category).toBe('B');
    // ASCENDING: above b1 means a SMALLER order. This is the direction that
    // was wrong before 2026-09-21 — see OrderDir in txn.ts.
    expect(moved?.order).toBeLessThan(10);
    expect(moved?.updated).toBe(5000);
  });

  it('lands at the END of the destination when nothing is named', () => {
    const moved = moveLineTo(all, all[0]!, 'B', null, 5000);
    expect(moved?.order).toBeGreaterThan(10);
  });

  it('takes an EMPTY category — the common case for a new one', () => {
    const moved = moveLineTo(all, all[0]!, 'C', null, 5000);
    expect(moved?.category).toBe('C');
    expect(moved?.order).toBe(0);
  });

  it('carries the money with the line, and changes nothing else about it', () => {
    // The amounts live in `budgets`, keyed by SET and LINE id (views.ts), and
    // the transactions point at the LINE — so nothing about a category move
    // touches either. What is budgeted and what has been spent are the same
    // afterwards; only the heading it is summed under has changed.
    const rich = line('a1', 'A', 10, { budget: 25000, needs: 30000, snoozed: true, name: 'Coffee' });
    const moved = moveLineTo([rich, ...all.slice(1)], rich, 'B', null, 5000);
    expect(moved).toMatchObject({
      id: 'a1', name: 'Coffee', budget: 25000, needs: 30000, snoozed: true, category: 'B',
    });
  });

  it('costs nothing when the line lands exactly where it was', () => {
    // Same category, same slot: no record, no merge clock, nothing to sync.
    expect(moveLineTo(all, all[0]!, 'A', 'a2', 5000)).toBeNull();
    expect(moveLineTo(all, all[1]!, 'A', null, 5000)).toBeNull();
  });

  it('reorders WITHIN a category too, so one gesture covers both', () => {
    const moved = moveLineTo(all, all[1]!, 'A', 'a1', 5000);
    expect(moved?.category).toBe('A');
    expect(linesIn([moved!, all[0]!], 'A').map((l) => l.id)).toEqual(['a2', 'a1']);
  });
});
