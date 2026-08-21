/**
 * The top bar, shaped like CalMind's.
 *
 * One row, in the same place on every screen: the screen's name on the left,
 * the screen's own controls on the right, then the section picker in a ringed
 * circle, then a divider. Sean's ask, 2026-08-21 — the two apps sit next to
 * each other on the same phone, and a bar that is nearly the same is worse
 * than one that is plainly different, because it reads as a mistake.
 *
 * WHAT IS DELIBERATELY NOT COPIED. CalMind draws its bar controls at 32 and
 * buys back the missing touch area with `hitSlop={8}`. That is a no-op under
 * react-native-web — a control is exactly as big as it is drawn in a browser
 * and bigger on native, so the two surfaces disagree silently, in the
 * direction that hurts Safari on a phone. This repo's rule is that controls
 * are DRAWN at TAP. So the RING is 32, matching CalMind pixel for pixel, and
 * the pressable around it is 44: the same bar to look at, hittable on the web.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPACE, T, TAP } from './theme';

/** The drawn size of every control in the bar. CalMind's number. */
export const TOPBAR_CTRL = 32;

export function TopBar({ title, titleTestID, controls, picker }: {
  title: string;
  titleTestID?: string | undefined;
  /** The screen's own controls, right-aligned, before the picker. */
  controls?: ReactNode;
  /**
   * The section picker — CalMind's folder slot, last in the row.
   *
   * It draws its OWN ring rather than being wrapped in one here: the ring is
   * 32 and the pressable around it has to be 44, so a wrapper would either
   * clip the target or stop matching the other controls. `SectionPick`'s
   * compact mode is the same 44-over-32 shape `CircleBtn` uses.
   */
  picker?: ReactNode;
}) {
  return (
    <>
      <View style={styles.bar}>
        {/* The title is what gives at a narrow width: it can ellipsize, and
            the controls cannot shrink without becoming unhittable. */}
        <Text style={styles.appname} numberOfLines={1} testID={titleTestID}>{title}</Text>
        <View style={styles.right}>
          {controls}
          {picker}
        </View>
      </View>
      <View style={styles.rule} testID="top-rule" />
    </>
  );
}

/**
 * A round bar control: a 32 ring drawn inside a 44 target.
 *
 * `on` fills it with the accent, for a control that is a state rather than an
 * action — the collapse-all arrow and the `.00` toggle both are.
 */
export function CircleBtn({ glyph, label, onPress, on = false, testID, children }: {
  glyph?: string;
  label: string;
  onPress: () => void;
  on?: boolean;
  testID?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      testID={testID}
    >
      <View style={[styles.ring, on && styles.ringOn]}>
        {/* Three characters do not fit a 32pt circle at a single glyph's
            size — `.00` is a label, not an icon, and gets the smaller face. */}
        {children ?? (
          <Text style={[styles.glyph, (glyph ?? '').length > 1 && styles.glyphSmall, on && styles.glyphOn]}>
            {glyph}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * The row under the divider: what the screen totals on the left, its sort or
 * filter on the right.
 *
 * It exists because CalMind's bar is ONE row and this app has a running total
 * to show. Rather than grow the bar to two rows and stop matching, the total
 * moved below the rule, where the sort control was already going to live.
 */
export function BarRow({ children }: { children: ReactNode }) {
  return <View style={styles.barRow}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingTop: SPACE.xs,
    minHeight: TAP,
  },
  // 24/800, CalMind's `appname`, not the 32/700 this screen used to carry.
  appname: { color: T.text, fontSize: 24, fontWeight: '800', flexShrink: 1, minWidth: 0 },
  // One gap for the whole row. CalMind arrived at 8 after having three
  // different gaps in one bar.
  right: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexShrink: 0 },
  rule: {
    height: StyleSheet.hairlineWidth, backgroundColor: T.cardEdge,
    marginHorizontal: SPACE.lg, marginBottom: 10,
  },
  hit: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: TOPBAR_CTRL, height: TOPBAR_CTRL, borderRadius: TOPBAR_CTRL / 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    backgroundColor: T.card, alignItems: 'center', justifyContent: 'center',
  },
  ringOn: { backgroundColor: T.accent, borderColor: T.accent },
  glyph: { color: T.text, fontSize: 15, fontWeight: '700' },
  glyphSmall: { fontSize: 12, letterSpacing: -0.2 },
  glyphOn: { color: '#ffffff' },
  barRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm, minHeight: TAP,
  },
});
