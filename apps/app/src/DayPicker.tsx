/**
 * The date picker: a month grid in a modal.
 *
 * Hand-drawn rather than a native picker, deliberately. A native date picker
 * is a different control on iOS, on Android and in a browser, which means
 * three behaviours, three sets of gestures, and nothing the web harness can
 * drive the way a person would. This is one control on all six surfaces, and
 * every date rule it uses — the grid, the clamping, the labels — comes from
 * core and is already covered by `spec/day.json`.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { WEEKDAYS, addMonths, monthGrid, monthLabel, startOfMonth, today } from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

type Props = {
  visible: boolean;
  /** The day currently chosen — the grid opens on its month. */
  value: string;
  onPick: (day: string) => void;
  onCancel: () => void;
};

export function DayPicker({ visible, value, onPick, onCancel }: Props) {
  const [month, setMonth] = useState(() => startOfMonth(value));
  const insets = useSafeAreaInsets();
  const now = today();

  // Reopening on a different date should land on that date's month rather
  // than wherever the grid was left. `visible` going false is the reset.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setMonth(startOfMonth(value));
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      {/* A Modal is its own window, OUTSIDE the app's safe area — anything
          positioned here sits under the clock on a phone unless the insets
          are applied again inside it. Invisible in every browser test. */}
      <View style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Pressable
              onPress={() => setMonth(addMonths(month, -1))}
              style={styles.arrow}
              accessibilityLabel="Previous month"
              testID="month-prev"
            >
              <Text style={styles.arrowText}>‹</Text>
            </Pressable>
            <Text style={styles.month} testID="month-label">{monthLabel(month)}</Text>
            <Pressable
              onPress={() => setMonth(addMonths(month, 1))}
              style={styles.arrow}
              accessibilityLabel="Next month"
              testID="month-next"
            >
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </View>

          <View style={styles.week}>
            {WEEKDAYS.map((d, i) => (
              // Two days start with S and two with T, so the index has to be
              // part of the key — the letter alone is not unique.
              <Text key={`${d}${i}`} style={styles.weekday}>{d}</Text>
            ))}
          </View>

          {monthGrid(month).map((row, r) => (
            <View key={r} style={styles.week}>
              {row.map((day, c) => {
                if (day === null) return <View key={c} style={styles.cell} />;
                const selected = day === value;
                return (
                  <Pressable
                    key={c}
                    onPress={() => onPick(day)}
                    style={[styles.cell, selected && styles.cellOn]}
                    accessibilityLabel={day}
                    testID={`day-${day}`}
                  >
                    <Text style={[
                      styles.cellText,
                      day === now && !selected && styles.cellToday,
                      selected && styles.cellTextOn,
                    ]}>
                      {Number(day.slice(8))}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <View style={styles.foot}>
            <Pressable onPress={() => onPick(now)} style={styles.footBtn} testID="pick-today">
              <Text style={styles.footText}>Today</Text>
            </Pressable>
            <Pressable onPress={onCancel} style={styles.footBtn} testID="pick-cancel">
              <Text style={[styles.footText, { color: T.dim }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: SPACE.lg,
  },
  sheet: {
    width: '100%', maxWidth: 360, backgroundColor: T.card, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge, padding: SPACE.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // TAP square: hitSlop is a no-op under react-native-web, so a control is
  // exactly as big as it is drawn here. Draw it big enough.
  arrow: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: T.accent, fontSize: 28, lineHeight: 32 },
  month: { color: T.text, fontSize: 17, fontWeight: '600' },
  week: { flexDirection: 'row' },
  weekday: {
    flex: 1, textAlign: 'center', color: T.dim, fontSize: 12,
    paddingVertical: SPACE.xs,
  },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  cellOn: { backgroundColor: T.accent },
  cellText: { color: T.text, fontSize: 15 },
  cellToday: { color: T.accent, fontWeight: '700' },
  cellTextOn: { color: '#ffffff', fontWeight: '700' },
  foot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACE.sm },
  footBtn: { minHeight: TAP, justifyContent: 'center', paddingHorizontal: SPACE.md },
  footText: { color: T.accent, fontSize: 16 },
});
