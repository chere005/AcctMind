/**
 * Where a dragged row lands — the half of the drag a screen used to decide.
 *
 * `rowslots.ts` is CoreMind canon, byte-identical with the copy CalMind,
 * ChefMind and MyCalMind carry (consumers/AcctMind.tsv, `exact`), and it
 * arrived here on 2026-09-21 with Sean's "make it possible to drag items
 * between sections and folders in budget". The rule it states is the one
 * that repo paid for on 2026-09-19 — "dragging was buggy … when sections
 * were closed and between sections generally" — and the two things that fix
 * it are both about the section HEADER: the flat list is exactly what is
 * DRAWN (a shut section contributes its header and none of its rows), and
 * the header is a drop target of its own, which is what makes "the end of
 * this section" expressible at all.
 *
 * The cases below are that file's cases. Taking the rule without taking its
 * evidence would be taking the half that cannot fail.
 */
import { describe, expect, it } from 'vitest';
import { dropTarget, slotEntries, type SlotEntry } from '../src/index';

const H = (s: string): SlotEntry => ({ kind: 'head', sectionId: s });
const R = (s: string, id: string): SlotEntry => ({ kind: 'row', sectionId: s, id });
const E = (s: string): SlotEntry => ({ kind: 'empty', sectionId: s });

describe('two open sections', () => {
  // A: a1 a2   B: b1 b2
  const list = [H('A'), R('A', 'a1'), R('A', 'a2'), H('B'), R('B', 'b1'), R('B', 'b2')];

  it('keeps a row dragged to the bottom of its own section IN it', () => {
    // The whole complaint, in one case: this boundary sits above B's header,
    // and without the header in the list it read as "before b1" — so the row
    // left the section the hand had dropped it in.
    expect(dropTarget(list, 1, 2)).toEqual({ sectionId: 'A', beforeId: null });
  });

  it('reads one notch further down as the top of the next section', () => {
    expect(dropTarget(list, 1, 3)).toEqual({ sectionId: 'B', beforeId: 'b1' });
  });

  it('lands between two rows above the lower one', () => {
    expect(dropTarget(list, 1, 4)).toEqual({ sectionId: 'B', beforeId: 'b2' });
  });

  it('reads past the last row as the end of the last section', () => {
    expect(dropTarget(list, 1, 5)).toEqual({ sectionId: 'B', beforeId: null });
  });

  it('lands a drag to the very top above the first row', () => {
    expect(dropTarget(list, 4, 0)).toEqual({ sectionId: 'A', beforeId: 'a1' });
  });

  it('reads a drag upward onto a header as the end of the section above', () => {
    expect(dropTarget(list, 4, 3)).toEqual({ sectionId: 'A', beforeId: null });
  });

  it('refuses a header as a drag SOURCE', () => {
    expect(dropTarget(list, 0, 3)).toBeNull();
  });
});

describe('a section that is shut', () => {
  // B is closed, so B's rows are not drawn and are not entries at all.
  const list = [H('A'), R('A', 'a1'), R('A', 'a2'), H('B'), H('C'), R('C', 'c1')];

  it('still ends A at the end of A', () => {
    expect(dropTarget(list, 1, 2)).toEqual({ sectionId: 'A', beforeId: null });
  });

  it('joins a row dropped under a shut header to that section', () => {
    expect(dropTarget(list, 1, 3)).toEqual({ sectionId: 'B', beforeId: null });
  });

  it('leaves the section after it reachable rather than skipped', () => {
    expect(dropTarget(list, 1, 4)).toEqual({ sectionId: 'C', beforeId: 'c1' });
  });
});

describe('an open section with nothing in it', () => {
  const list = [H('A'), R('A', 'a1'), H('B'), E('B'), H('C'), R('C', 'c1')];

  it('takes the row onto its placeholder', () => {
    expect(dropTarget(list, 1, 2)).toEqual({ sectionId: 'B', beforeId: null });
    expect(dropTarget(list, 1, 3)).toEqual({ sectionId: 'B', beforeId: null });
  });
});

describe('slotEntries', () => {
  it('keeps the kind, the section and a row id, and drops the record', () => {
    // Each screen puts its own record on the entry. The rule sees none of it,
    // which is what lets one rule serve the ledger and the budget at once.
    expect(slotEntries([
      { kind: 'head', sectionId: 'A' },
      { kind: 'row', sectionId: 'A', rec: { id: 'a1', name: 'Coffee' } as { id: string } },
      { kind: 'empty', sectionId: 'B' },
    ])).toEqual([H('A'), R('A', 'a1'), E('B')]);
  });
});
