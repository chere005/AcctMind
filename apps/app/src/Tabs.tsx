/**
 * The two tabs: Budget, then Transactions.
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
      <Text style={[styles.text, on && styles.textOn]}>{label}</Text>
      {/* The underline is drawn always and hidden by colour, so selecting a
          tab cannot change the bar's height and shift the list beneath it. */}
      <View style={[styles.rule, on && styles.ruleOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', paddingHorizontal: SPACE.lg, gap: SPACE.xl,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  tab: { minHeight: TAP, justifyContent: 'flex-end', gap: SPACE.xs },
  text: { color: T.dim, fontSize: 16, fontWeight: '600' },
  textOn: { color: T.text },
  rule: { height: 2, borderRadius: 1, backgroundColor: 'transparent' },
  ruleOn: { backgroundColor: T.accent },
});
