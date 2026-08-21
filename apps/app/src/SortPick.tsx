/**
 * Sort by: custom, date, amount — a dropdown.
 *
 * It was three chips in a row. Sean, 2026-08-21: a dropdown. Three chips cost
 * a permanent strip of the bar to show two answers nobody asked for, and the
 * bar is the same row the account picker and the total have to fit into on a
 * phone; a dropdown shows the ANSWER and hides the alternatives until they
 * are wanted.
 *
 * Deliberately the same menu as `SectionPick` — same modal, same rows, same
 * tick — because they now sit next to each other, and two dropdowns that open
 * differently in one row is a thing a person notices without being able to
 * say why.
 */
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SortMode } from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

const MODES: [SortMode, string][] = [
  ['custom', 'Custom'],
  ['date', 'Date'],
  ['amount', 'Amount'],
];

const NAME = (m: SortMode) => MODES.find(([k]) => k === m)?.[1] ?? 'Date';

export function SortPick({ mode, onPick, visible, onOpen, onClose }: {
  mode: SortMode;
  onPick: (m: SortMode) => void;
  visible: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <>
      <Pressable
        onPress={onOpen}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${NAME(mode)}`}
        testID="sort-pick"
      >
        <Text style={styles.buttonText} numberOfLines={1} testID="sort-pick-label">
          {NAME(mode)}
        </Text>
        <Text style={styles.chev}>⌄</Text>
      </Pressable>

      {visible && (
        <Modal transparent animationType="fade" onRequestClose={onClose}>
          {/* Its own window: the app's safe area does not reach in here. */}
          <Pressable style={styles.backdrop} onPress={onClose} testID="sort-menu-backdrop">
            {/* Two controls down, not one: this opens from the row UNDER the
                divider, so hanging it at one control's height would drop it
                over the title. `SectionPick` opens from the bar itself and
                stays at TAP. */}
            <Pressable style={[styles.menu, { marginTop: insets.top + TAP * 2 }]} onPress={() => {}}>
              {MODES.map(([m, label], i) => (
                <Pressable
                  key={m}
                  onPress={() => { onPick(m); onClose(); }}
                  style={[styles.row, i === MODES.length - 1 && styles.last]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === m }}
                  testID={`sort-${m}`}
                >
                  <Text style={[styles.rowText, mode === m && styles.rowOn]}>{label}</Text>
                  {mode === m && <Text style={styles.tick}>✓</Text>}
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    minHeight: TAP, paddingLeft: SPACE.sm,
  },
  buttonText: { color: T.text, fontSize: 15, fontWeight: '600' },
  chev: { color: T.dim, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#00000088' },
  menu: {
    marginHorizontal: SPACE.lg, borderRadius: 14,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    minHeight: TAP, paddingHorizontal: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  last: { borderBottomWidth: 0 },
  rowText: { color: T.text, fontSize: 16, flex: 1 },
  rowOn: { fontWeight: '700' },
  tick: { color: T.accent, fontSize: 16, fontWeight: '700' },
});
