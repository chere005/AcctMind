/**
 * A little box under one budget amount.
 *
 * Sean, 2026-08-21, three goes at this. It was a full screen, then a card at
 * the top behind a dark wash, and now what was actually asked for: "very
 * small, like a little box directly underneath with an input field, and
 * beneath the input field is 3 small buttons.. no need for done, the user can
 * just hit return or tap away."
 *
 * So: no dim backdrop, because on a near-black app a 53%-black wash makes the
 * list you were reading to decide the number invisible. No title, because the
 * box sits under the column it belongs to and that says which number it is.
 * No Done, because Return commits and so does tapping away — a button for a
 * thing two natural gestures already do is a button in the way.
 *
 * TAPPING AWAY COMMITS, it does not cancel. That is Sean's instruction and it
 * is worth being explicit about, because the previous version did the
 * opposite and had a test pinning it. There is no cancel: the value is live,
 * the row behind shows it land, and `−` puts back whatever `+` just added.
 */
import { Dimensions, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OpAmount } from './OpAmount';
import { SPACE, T } from './theme';

/** Where the tapped amount sits, in window coordinates. */
export type Anchor = { x: number; y: number; w: number; h: number };

/**
 * Wide enough for three small buttons and the running total, and no wider.
 *
 * 168, down from 214 and then 200 — Sean asked for smaller three times, so
 * this is the size he means rather than the size that felt safe. Everything
 * in it shrank with it; see OpAmount's compact styles.
 */
const BOX = 168;

export function AmountPad({ visible, value, anchor, onValue, onDone }: {
  visible: boolean;
  value: number;
  anchor: Anchor | null;
  onValue: (next: number) => void;
  /** Return, or a tap outside. There is no other way out and no cancel. */
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  const { width: screenW, height: screenH } = Dimensions.get('window');
  const below = (anchor?.y ?? 0) + (anchor?.h ?? 0) + 4;
  /*
   * Flip above the row when hanging below would land in the half of the
   * screen a keyboard takes. Anchored by its BOTTOM in that case, so the
   * box's own height — which nothing here has measured — need not be known.
   */
  const flip = anchor !== null && below > screenH * 0.42;
  const vertical = anchor === null
    ? { top: insets.top + 48 }
    : flip ? { bottom: screenH - anchor.y + 4 } : { top: below };

  /*
   * CENTRED on the tapped cell, then clamped to the screen.
   *
   * It was aligned to the cell's right edge, on the reasoning that the
   * amounts are right-aligned so their right edge is where the eye is. Sean,
   * 2026-08-21: centred. Which is the better rule anyway — a box under the
   * middle of what you touched reads as belonging to it from either side,
   * where a right-aligned one leans away from a cell near the left of its
   * column.
   *
   * The clamp is what makes centring safe rather than clever: the rightmost
   * column would put a centred box off the edge of the screen, so it stops
   * at the margin instead. Nothing is ever partly off-screen, and nothing
   * needs a special case for the first or last column.
   */
  const middle = (anchor?.x ?? 0) + (anchor?.w ?? 0) / 2;
  const left = anchor === null
    ? (screenW - BOX) / 2
    : Math.max(SPACE.sm, Math.min(screenW - BOX - SPACE.sm, middle - BOX / 2));

  return (
    <Modal transparent animationType="none" onRequestClose={onDone}>
      {/* Transparent, and deliberately: it catches the tap that finishes the
          edit, and paints nothing so the page behind stays readable. */}
      <Pressable style={styles.backdrop} onPress={onDone} testID="pad-backdrop">
        {/* Swallows the tap so a press inside does not commit and close. */}
        <Pressable style={[styles.box, vertical, { left, width: BOX }]} onPress={() => {}}>
          <OpAmount value={value} onValue={onValue} onSubmit={onDone} autoFocus compact testID="pad-amount" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  box: {
    position: 'absolute',
    borderRadius: 10, padding: SPACE.xs + 2, gap: SPACE.xs,
    backgroundColor: T.bg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    // It floats over the list rather than replacing it, so it needs to read
    // as in front — there is no wash behind it doing that any more.
    shadowColor: '#000000', shadowOpacity: 0.55,
    shadowRadius: 14, shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
});
