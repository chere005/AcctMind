/**
 * The bar at the foot of the ledger: how many rows are picked, what they
 * come to, the two ways to change that wholesale, and a two-press Delete.
 *
 * ChefMind's `app/src/components/PickBar.tsx`, brought over on Sean's word
 * (2026-09-21: "take the 'selected' behavior from chefmind and implement
 * that here"), and promoted into CoreMind canon in the same change —
 * `canon/app/src/components/PickBar.tsx`. THIS COPY IS A FORK and
 * `consumers/AcctMind.tsv` says so, for two reasons that are both this
 * repo's rules rather than preferences:
 *
 *   - ChefMind's copy is `themed()` over a light/dark palette. AcctMind has
 *     one palette and no `themed`, so every colour here is a straight
 *     substitution: `line`→`cardEdge`, `surface`→`card`, `accentInk`→`#fff`.
 *   - ChefMind buys its touch area back with `WebHitSlop`. `hitSlop` is a
 *     no-op under react-native-web, and this repo's answer is to DRAW at
 *     `TAP` — so each control is a 44pt target with the pill drawn inside
 *     it, exactly the shape `CircleBtn` uses for the top bar's 32pt rings.
 *
 * WHAT IS NOT A FORK is the behaviour, and that is the point of the copy:
 * the same four controls in the same order, the same two-press Delete on the
 * same 2.5s fuse, the same "All and Clear live HERE, beside the count they
 * act on, and Delete is pushed to the far end where no thumb heading for
 * Clear can reach it" (Sean to ChefMind, 2026-09-16).
 *
 * `detail` is the one thing ChefMind's bar has no use for. Here the
 * selection is FOR adding up — Sean, 2026-08-21: "when multiple transactions
 * are selected, show the sum of their amounts" — so the sum rides beside the
 * count rather than in a bar of its own. It is a string because the bar does
 * no arithmetic: `selectedTotal` is core's and the screen has already asked.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPACE, T, TAP } from './theme';

export function PickBar({ prefix, count, detail, onAll, onClear, onDelete }: {
  /** Names the testIDs, so the controls stay findable by name. */
  prefix: string;
  count: number;
  /** The selection's sum, already formatted. Omitted when nothing is picked. */
  detail?: string | undefined;
  /** Pick everything the screen is showing. */
  onAll: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  /**
   * Two presses, and the first one turns it red — the suite's delete
   * gesture, in a bar wide enough for the word rather than the round × the
   * rows wear.
   *
   * It disarms itself after 2.5s, so a bar left armed on a screen you walked
   * away from cannot delete on the next stray tap. It also disarms the
   * moment the SELECTION changes: arming on three rows and then picking a
   * fourth would otherwise leave a press that deletes something the arming
   * never saw.
   */
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setArmed(false);
    clearTimeout(timer.current);
  }, [count]);
  // A timer that outlives the screen fires `setArmed` into an unmounted tree.
  useEffect(() => () => clearTimeout(timer.current), []);
  const armOrDelete = () => {
    if (!armed) {
      setArmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 2500);
      return;
    }
    clearTimeout(timer.current);
    setArmed(false);
    onDelete();
  };

  return (
    <View style={styles.bar} testID={`${prefix}-bar`}>
      <Text style={styles.count} numberOfLines={1} testID={`${prefix}-count`}>
        {count} selected{detail === undefined ? '' : ` · ${detail}`}
      </Text>
      {/* Two buttons, not one toggle: "select none" and "select all" are
          opposite intentions, and a control that silently swaps between them
          is one you have to read before you can press. */}
      <Pressable
        testID={`${prefix}-all`}
        accessibilityRole="button"
        accessibilityLabel="Select all"
        onPress={onAll}
        style={styles.hit}
      >
        <View style={styles.pick}><Text style={styles.pickText}>All</Text></View>
      </Pressable>
      <Pressable
        testID={`${prefix}-clear`}
        accessibilityRole="button"
        accessibilityLabel="Select none"
        onPress={onClear}
        style={styles.hit}
      >
        <View style={styles.pick}><Text style={styles.pickText}>Clear</Text></View>
      </Pressable>
      {/* The space in "All, Clear, space, Delete". It takes whatever is left,
          so Delete ends the bar at every width instead of following Clear
          about. */}
      <View style={styles.spacer} />
      <Pressable
        testID={`${prefix}-delete`}
        accessibilityRole="button"
        accessibilityLabel={armed ? `Confirm deleting ${count}` : `Delete ${count}`}
        accessibilityState={{ disabled: count === 0 }}
        disabled={count === 0}
        onPress={armOrDelete}
        style={styles.hit}
      >
        {/* 'Delete?' armed, not 'Delete 12?' — the count is already in this
            bar two buttons away, and the longer word wraps the row at phone
            width. The accessibility label still carries the number, where
            there is room for it. */}
        <View style={[styles.del, armed && styles.delArmed, count === 0 && styles.delOff]}>
          <Text style={[styles.delText, armed && styles.delTextArmed]} numberOfLines={1}>
            {armed ? 'Delete?' : 'Delete'}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  spacer: { flex: 1 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm,
    paddingHorizontal: SPACE.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.cardEdge,
    backgroundColor: T.card,
  },
  // The count is what GIVES at a narrow width: the buttons cannot shrink
  // without becoming unhittable, and "12 selected · -$1,234.56" wrapping to
  // two lines makes the whole bar two rows tall.
  count: { color: T.dim, fontSize: 14, flexShrink: 1, fontVariant: ['tabular-nums'] },
  // 44 tall and transparent, with the pill drawn inside — the top bar's
  // 44-over-32 shape (see TopBar's CircleBtn), and the reason is the same:
  // hitSlop is a no-op on the web, so a control is exactly as big as it is
  // drawn there.
  hit: { minHeight: TAP, justifyContent: 'center', flexShrink: 0 },
  // A shade smaller than Delete, and the same rounded rectangle, so the pair
  // reads as one kind of control and Delete as another. They change a
  // SELECTION; Delete acts on the things selected, and the size says which
  // is which before the words are read.
  pick: {
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  pickText: { color: T.dim, fontSize: 13, fontWeight: '600' },
  del: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  delArmed: { backgroundColor: T.danger, borderColor: T.danger },
  // Nothing picked, nothing to delete. Dimmed AND disabled: a live control
  // that does nothing is the one that gets pressed twice.
  delOff: { opacity: 0.4 },
  delText: { color: T.text, fontSize: 14, fontWeight: '600' },
  delTextArmed: { color: '#ffffff' },
});
