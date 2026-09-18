/**
 * What an icon means, said on hover and on tap.
 *
 * Sean, 2026-09-18: "add tooltips to the icons for assigned, spent, etc."
 *
 * The budget's column heads are MARKS rather than words for a reason — at 56
 * points `BUDGETED` drew as `BUDGETE / D` — and the accessibility label has
 * always carried the word for a screen reader. This is that same word for
 * everyone else: the one group of people the icons were hardest on were the
 * ones who could see them.
 *
 * ONE COMPONENT FOR BOTH GESTURES, because there are two shapes of surface
 * here and neither can be the only one. A Mac has a pointer and expects a
 * hover; a phone has no pointer at all and a tooltip that only appears on
 * hover is a tooltip that does not exist there. So `onHoverIn` shows it (a
 * no-op on a touch screen — react-native-web raises it from the mouse, and
 * nothing raises it on a device without one) and a press flashes it up for a
 * couple of seconds.
 *
 * ANCHORED TOP-RIGHT, not centred. The columns are right-aligned and so is
 * every number under them, so the bubble hangs from the same edge the mark
 * does — which is also what keeps the last column's bubble on the screen,
 * since it can only ever grow leftwards.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SPACE, T } from './theme';

/** How long a TAPPED tip stays up. Long enough to read three words. */
const TIP_MS = 2200;

export function useTip(): {
  shown: boolean;
  /** Spread onto the Pressable the mark lives in. */
  hover: { onHoverIn: () => void; onHoverOut: () => void };
  /** Show it for a moment — what a tap does, where there is no pointer. */
  flash: () => void;
} {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
  };
  // Cleared on unmount. Without it a tip flashed on a row that then goes —
  // a category folded, a line deleted — leaves a timeout holding a setState
  // on a component that is not there any more.
  useEffect(() => stop, []);

  return {
    shown,
    hover: {
      // A pointer arriving OWNS it: whatever a previous tap left running
      // stops, and the tip stays up until the pointer leaves.
      onHoverIn: () => { stop(); setShown(true); },
      /*
       * A FLASH OUTRANKS A HOVER ENDING, and that is not a nicety.
       *
       * A browser on a touch screen raises hover events around a tap as well
       * as press ones, and it raises the hover ENDING last — so a tap read in
       * the obvious order is: show, flash, hide, all inside one finger press,
       * and the tip never appears at all on the surface that has no other way
       * to ask for it. While the flash's own timer is running it is the thing
       * holding the tip up, and a pointer leaving has nothing to say about it.
       */
      onHoverOut: () => { if (timer.current === null) setShown(false); },
    },
    flash: () => {
      stop();
      setShown(true);
      timer.current = setTimeout(() => { timer.current = null; setShown(false); }, TIP_MS);
    },
  };
}

/**
 * The bubble itself, for a control that already owns its own Pressable.
 *
 * `above` hangs it over what it belongs to rather than under it, and which
 * way it goes is a question about PAINT ORDER, not taste. A row of the budget
 * is opaque, so a bubble hanging down from a number in it is covered by the
 * next row entirely; hanging UP it lands on the row's own name line, which is
 * the row's own space and nobody else's. A column head hangs down for the
 * mirror of the same reason — there is nothing above it but the category.
 */
export function TipBubble({ text, shown, above = false }: {
  text: string;
  shown: boolean;
  above?: boolean;
}) {
  if (!shown) return null;
  return (
    // NEVER a target: a bubble that appears under the pointer and then eats
    // the next click is worse than no bubble at all.
    <View pointerEvents="none" style={[styles.bubble, above ? styles.above : styles.below]}>
      <Text style={styles.text} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** A mark that is not a control otherwise: hover or tap it to be told what it is. */
export function Tip({ text, label, above = false, style, testID, children }: {
  text: string;
  /**
   * What a screen reader hears, when that is more than the tip says.
   *
   * A number's tip is the COLUMN — "Spent" — because the number is right
   * there to be read. A screen reader cannot read what is right there off a
   * button whose label it has been given, so the label says both.
   */
  label?: string;
  above?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
  children: ReactNode;
}) {
  const tip = useTip();
  return (
    <Pressable
      onHoverIn={tip.hover.onHoverIn}
      onHoverOut={tip.hover.onHoverOut}
      onPress={tip.flash}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label ?? text}
      testID={testID}
    >
      {children}
      <TipBubble text={text} shown={tip.shown} above={above} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute', right: 0,
    paddingHorizontal: SPACE.xs, paddingVertical: 3, borderRadius: 6,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    // Above what comes after it in the tree, which is the whole list.
    zIndex: 30, elevation: 30,
  },
  below: { top: '100%', marginTop: 2 },
  above: { bottom: '100%', marginBottom: 2 },
  text: { color: T.text, fontSize: 11, lineHeight: 14 },
});
