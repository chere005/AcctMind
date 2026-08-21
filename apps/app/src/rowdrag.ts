/**
 * Dragging a row by its grip.
 *
 * Sean, 2026-08-21: "moving should be done with the small drag icon to the
 * left of the field like in CalMind." This is AcctMind's own implementation
 * of that gesture, written after reading `CalMind/apps/app/src/components/
 * rowdrag.ts` — nothing is imported from there, per the standing rule, but
 * every hard-won detail below came from it and is called out where it did.
 *
 * The feedback rule carries over: NOTHING moves during the drag. The dragged
 * row dims and rides the finger, a single line shows where it would land, and
 * the list reorders once on release. A list that rearranges under a moving
 * finger is a list you cannot aim at.
 *
 * WHAT THE HARNESS CANNOT SEE. React-native-web's PanResponder does not
 * engage under Playwright's synthetic mouse — this repo already deleted two
 * swipe tests that passed because NOTHING HAPPENED. So the decision this
 * makes is deliberately thin: it converts a finger into a destination INDEX
 * and hands it to `reorder` in core, which has its own tests. What is left
 * here is arithmetic on measured geometry, and it is checked by eye on a
 * simulator.
 */
import { useRef, useState } from 'react';
import { PanResponder, type PanResponderInstance, type View } from 'react-native';

export type RowDrag = {
  /** Attach to row `i`'s View so the grant can measure where it is. */
  registerRow: (i: number) => (ref: View | null) => void;
  /** Pan handlers for row `i`'s grip. */
  gripFor: (i: number) => PanResponderInstance['panHandlers'];
  /** The row being dragged, or null. */
  dragIdx: number | null;
  /** How far it has travelled, for the transform. */
  dragDy: number;
  /** The boundary the drop line sits on (0..count), or null for no move. */
  slot: number | null;
};

export function useRowDrag(count: number, onDrop: (from: number, to: number) => void): RowDrag {
  const [ui, setUi] = useState<{ dragIdx: number | null; dragDy: number; slot: number | null }>({
    dragIdx: null, dragDy: 0, slot: null,
  });

  // Live values behind a ref. A responder REBUILT mid-gesture drops the
  // gesture on the floor — in CalMind that showed up as the browser starting
  // a text selection instead of a drag — so the responders are created once
  // per index and read everything through here.
  const cfg = useRef({ count, onDrop });
  cfg.current = { count, onDrop };

  const rows = useRef(new Map<number, View>());
  /** Each row's midpoint in WINDOW space, filled at grant. */
  const mids = useRef(new Map<number, number>());
  const responders = useRef(new Map<number, PanResponderInstance>());

  const registerRow = (i: number) => (ref: View | null) => {
    if (ref) rows.current.set(i, ref);
    else rows.current.delete(i);
  };

  const measure = async (): Promise<void> => {
    const entries = [...rows.current.entries()];
    const measured = await Promise.all(entries.map(([i, ref]) =>
      new Promise<{ i: number; mid: number }>((res) => {
        ref.measureInWindow((_x, y, _w, h) => res({ i, mid: y + h / 2 }));
      })));
    mids.current = new Map(measured.map((m) => [m.i, m.mid]));
  };

  /**
   * Where the row would land: the classic sortable rule on measured geometry.
   *
   * The dragged row's DISPLACED midpoint — its own midpoint plus total travel,
   * so where along the row you grabbed it cancels out — is compared with every
   * other row's midpoint, and the number it has passed IS the destination
   * index. Crossing a row's centre is what swaps with it, whatever height
   * anyone is; a uniform-row-height model breaks the moment a description
   * wraps.
   */
  const destFor = (i: number, dy: number): number | null => {
    const own = mids.current.get(i);
    if (own === undefined) return null;
    // A hair of direction-aware bias, so two centres landing exactly on top of
    // each other resolve the way the finger is heading rather than sitting on
    // the knife edge.
    const c = own + dy + (dy > 0 ? 0.5 : -0.5);
    let k = 0;
    for (const [j, mid] of mids.current) if (j !== i && mid < c) k++;
    return k === i ? null : k;
  };

  const gripFor = (i: number) => {
    if (!responders.current.has(i)) {
      responders.current.set(i, PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        /*
         * A grip's drag is never up for negotiation.
         *
         * The enclosing ScrollView asks for the responder as soon as the
         * pointer moves vertically, and the DEFAULT ANSWER IS YES — so on any
         * list long enough to scroll, the drag was granted, measured, and then
         * silently terminated before it could drop. Refusing the hand-over is
         * the whole difference between a drag that works on a three-row list
         * and one that works on a real one.
         */
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          setUi({ dragIdx: i, dragDy: 0, slot: null });
          void measure();
        },
        onPanResponderMove: (_e, g) => {
          const to = destFor(i, g.dy);
          setUi({ dragIdx: i, dragDy: g.dy, slot: to === null ? null : to > i ? to + 1 : to });
        },
        onPanResponderRelease: (_e, g) => {
          // From the RELEASE's own travel, not from the last move event: a
          // fast flick can land with barely any moves processed.
          const drop = () => {
            const to = destFor(i, g.dy);
            if (to === null) return;
            const bounded = Math.max(0, Math.min(cfg.current.count - 1, to));
            if (i !== bounded) cfg.current.onDrop(i, bounded);
          };
          setUi({ dragIdx: null, dragDy: 0, slot: null });
          // `measureInWindow` is async and a quick drag can be over before it
          // answers, which threw the whole gesture away. Nothing but the
          // dragged row moves during a drag, so a late measurement is just as
          // true as one taken at the grant — take it rather than lose the drop.
          if (mids.current.size === 0) void measure().then(drop);
          else drop();
        },
        onPanResponderTerminate: () => setUi({ dragIdx: null, dragDy: 0, slot: null }),
      }));
    }
    return responders.current.get(i)!.panHandlers;
  };

  return { ...ui, registerRow, gripFor };
}
