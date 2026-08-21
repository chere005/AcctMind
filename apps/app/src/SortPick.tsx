/**
 * Sort by: custom, date, amount.
 *
 * A row of three rather than a menu. There are only three, they are short,
 * and a dropdown for three options costs a tap to find out what they are.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SortMode } from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

const MODES: [SortMode, string][] = [['custom', 'Custom'], ['date', 'Date'], ['amount', 'Amount']];

export function SortPick({ mode, onPick }: { mode: SortMode; onPick: (m: SortMode) => void }) {
  return (
    <View style={styles.row} testID="sort-pick">
      {MODES.map(([m, label]) => (
        <Pressable
          key={m}
          onPress={() => onPick(m)}
          style={[styles.chip, mode === m && styles.on]}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === m }}
          testID={`sort-${m}`}
        >
          <Text style={[styles.text, mode === m && styles.textOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  // Short of TAP on purpose and the ONLY control here that is: three of them
  // plus the picker do not fit a phone at 44 each. They sit inside a row that
  // is TAP tall, so the touch target is full height even where the fill is not.
  chip: {
    minHeight: TAP - 12, justifyContent: 'center', paddingHorizontal: SPACE.sm,
    borderRadius: 8, backgroundColor: T.card,
  },
  on: { backgroundColor: T.accent },
  text: { color: T.dim, fontSize: 13, fontWeight: '600' },
  textOn: { color: '#ffffff' },
});
