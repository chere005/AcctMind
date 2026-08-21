/**
 * The bottom tab bar: Budget, then Transactions.
 *
 * At the BOTTOM, where a thumb is — the place iOS puts a UITabBar and the
 * only part of a phone screen that is comfortably reachable one-handed. It
 * sat under the title first, which put the app's most-used control in the
 * hardest place to press.
 *
 * A bar rather than a navigator. There are two screens and no history to
 * keep, so a router would be a dependency and a set of edge cases bought for
 * one boolean.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SPACE, T, TAP } from './theme';

export type Tab = 'budget' | 'transactions';

export function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <View style={styles.bar}>
      <TabButton label="Budget" on={tab === 'budget'} onPress={() => onTab('budget')} testID="tab-budget" />
      <TabButton
        label="Transactions"
        on={tab === 'transactions'}
        onPress={() => onTab('transactions')}
        testID="tab-transactions"
      />
    </View>
  );
}

function TabButton({ label, on, onPress, testID }: {
  label: string; on: boolean; onPress: () => void; testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      testID={testID}
    >
      {/* The rule is drawn always and hidden by colour, so selecting a tab
          cannot change the bar's height and shift the list above it. */}
      <View style={[styles.rule, on && styles.ruleOn]} />
      <Text style={[styles.text, on && styles.textOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', paddingHorizontal: SPACE.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.cardEdge,
    backgroundColor: T.bg,
  },
  tab: { flex: 1, minHeight: TAP + 6, justifyContent: 'center', alignItems: 'center', gap: SPACE.xs },
  text: { color: T.dim, fontSize: 16, fontWeight: '600' },
  textOn: { color: T.text },
  rule: { height: 2, width: 24, borderRadius: 1, backgroundColor: 'transparent' },
  ruleOn: { backgroundColor: T.accent },
});
