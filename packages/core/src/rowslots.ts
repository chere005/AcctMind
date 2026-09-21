/**
 * Where a dragged row actually LANDS, given the boundary it was dropped on.
 *
 * The row drag (rowdrag.ts) is deliberately dumb: it measures the entries that
 * are on screen and answers with an index. Turning that index into "this
 * section, before that row" is the screen's job, and it is the half that was
 * wrong (Sean, 2026-09-19: "dragging was buggy … when sections were closed and
 * between sections generally").
 *
 * Two rules make it right, and both of them are about the SECTION HEADER:
 *
 *  1. The flat list must be exactly what is DRAWN — headers included, and the
 *     rows of a folded section left out entirely. rowdrag measures what is
 *     registered, so an entry that renders nothing had no midpoint, and every
 *     index past a folded section was off by the rows hidden inside it. That
 *     is why a drag went wild the moment anything was collapsed.
 *
 *  2. A header is a drop target in its own right. Without one in the list, the
 *     gap between the last row of a section and the first row of the next is a
 *     SINGLE boundary that spans the header — so "the end of this section"
 *     could not be expressed at all, and a row dragged to the bottom of its
 *     own section silently joined the one below. With the header in the list
 *     there are two boundaries: above it (the end of the section before) and
 *     below it (the top of this one).
 *
 * The same rule gives closed sections something they never had: drop a row
 * just under a folded header and it lands at the end of that folded section.
 */

/** A drawn entry. `id` is set on rows only. */
export type SlotEntry = {
  kind: 'head' | 'empty' | 'row';
  sectionId: string;
  id?: string;
};

export type DropTarget = { sectionId: string; beforeId: string | null };

/**
 * A screen's own flat-entry list, narrowed to what the rule needs. Each screen
 * keeps its own record type on the entry; this drops everything but the kind,
 * the section and the row's id, so one rule serves Notes, Reminders and Habits
 * without any of them handing it their record shape.
 */
export function slotEntries(
  entries: readonly { kind: 'row' | 'empty' | 'head'; sectionId: string; rec?: { id: string } }[],
): SlotEntry[] {
  return entries.map((e) =>
    e.kind === 'row'
      ? { kind: e.kind, sectionId: e.sectionId, id: e.rec?.id }
      : { kind: e.kind, sectionId: e.sectionId },
  );
}

/**
 * `from` is the dragged entry's index; `to` is the index it would occupy after
 * the move, both into `entries`. The answer is the section it joins and the
 * row it lands above (null = the end of that section).
 */
export function dropTarget(entries: SlotEntry[], from: number, to: number): DropTarget | null {
  if (entries[from]?.kind !== 'row') return null;
  // The entry that will FOLLOW the dragged row, indexed in the list as it
  // stands now: moving down, everything it passed has shifted up by one.
  const slotIdx = to > from ? to + 1 : to;
  const before = entries[slotIdx];

  // Dropped past the last entry: the end of the last section drawn.
  if (!before) {
    const last = entries[entries.length - 1];
    return last ? { sectionId: last.sectionId, beforeId: null } : null;
  }
  if (before.kind === 'row') return { sectionId: before.sectionId, beforeId: before.id ?? null };
  // An empty section's placeholder IS that section, and it has no rows to land
  // above.
  if (before.kind === 'empty') return { sectionId: before.sectionId, beforeId: null };

  // A header. The row goes ABOVE it, which means the end of whatever section
  // is drawn above — skipping the dragged row itself, which is leaving.
  for (let j = slotIdx - 1; j >= 0; j--) {
    if (j === from) continue;
    return { sectionId: entries[j]!.sectionId, beforeId: null };
  }
  // Nothing above at all: the drop is at the very top of the list, so it means
  // the top of this first section rather than the end of a section that is not
  // there.
  const first = entries[slotIdx + 1];
  return {
    sectionId: before.sectionId,
    beforeId: first?.kind === 'row' && first.sectionId === before.sectionId ? first.id ?? null : null,
  };
}
