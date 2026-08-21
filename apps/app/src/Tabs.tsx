/**
 * The bottom tab bar, shaped like CalMind's: icon-only tabs either side of a
 * raised accent `+`.
 *
 * Sean's ask, 2026-08-21 — the two apps live on the same phone and the bars
 * should read as the same family. What that means concretely, copied from
 * `CalMind/apps/app/src/nav.tsx`: a hairline over the bar, the contents
 * capped at a column width so the tabs stay under the content on a wide
 * window instead of flying to the edges, a fixed circular halo behind the
 * active tab's icon, and the middle control a filled circle.
 *
 * The halo is FIXED-SIZE and always drawn, coloured in or out. A highlight
 * that appears and disappears is a highlight that can change the bar's
 * height, and the bar is the thing every screen is measured against.
 *
 * Why the `+` is here rather than in the top bar, where it used to be: it is
 * the app's most-used control and the bottom of the screen is the only part
 * of a phone a thumb reaches comfortably. It carries the `add-button` testID
 * it always had, so it is the same control to every test that drives it.
 */
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BudgetIcon, ListIcon, PlusMark } from './Icons';
import { SPACE, T, TAP } from './theme';

export type Tab = 'budget' | 'transactions';

/** Wide enough for the content, narrow enough that the tabs stay together. */
const BAR_MAX_WIDTH = 420;

export function Tabs({ tab, onTab, onAdd }: {
  tab: Tab;
  onTab: (t: Tab) => void;
  /** The middle button: opens the add form, from either tab. */
  onAdd: () => void;
}) {
  return (
    <View style={styles.outer}>
      <View style={styles.bar}>
        <TabButton
          label="Budget"
          on={tab === 'budget'}
          onPress={() => onTab('budget')}
          testID="tab-budget"
        >
          <BudgetIcon color={tab === 'budget' ? T.text : T.dim} />
        </TabButton>

        <Pressable
          onPress={onAdd}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
          testID="add-button"
        >
          <PlusMark />
        </Pressable>

        <TabButton
          label="Transactions"
          on={tab === 'transactions'}
          onPress={() => onTab('transactions')}
          testID="tab-transactions"
        >
          <ListIcon color={tab === 'transactions' ? T.text : T.dim} />
        </TabButton>
      </View>
    </View>
  );
}

function TabButton({ label, on, onPress, testID, children }: {
  label: string; on: boolean; onPress: () => void; testID: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      // An icon with no words has to say its own name, or it is a shape to
      // anyone using a screen reader.
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={[styles.halo, on && styles.haloOn]}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.cardEdge,
    backgroundColor: T.bg, alignItems: 'center',
  },
  bar: {
    width: '100%', maxWidth: BAR_MAX_WIDTH,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: SPACE.xs,
    ...(Platform.OS === 'web' ? { alignSelf: 'center' as const } : null),
  },
  // Drawn at TAP, not padded up to it with hitSlop — that is a no-op under
  // react-native-web, so the web would get a 38pt target and the phone a 44.
  tab: { minWidth: TAP, minHeight: TAP, alignItems: 'center', justifyContent: 'center' },
  halo: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  haloOn: { backgroundColor: T.card },
  add: {
    width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: T.accent,
    alignItems: 'center', justifyContent: 'center',
  },
});
