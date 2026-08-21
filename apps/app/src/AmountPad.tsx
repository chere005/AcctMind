/**
 * A small pad for one budget amount, over the Budget page.
 *
 * Sean, 2026-08-21: "tapping the budgeted and available amounts should just
 * bring a small input field with the = + and - buttons underneath defaulting
 * to + over the Budget page, not another new screen."
 *
 * It was a full-screen editor and that was the wrong weight for the job:
 * changing one number is a two-second thought, and a screen that slides in
 * over everything, has its own Cancel and Save, and hides the list you were
 * reading costs more than the edit does. The list stays visible behind this.
 *
 * It sits at the TOP rather than centred, because a keyboard comes up with
 * it: anything vertically centred on a phone ends up underneath one.
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatAmount } from '@acctmind/core';
import { OpAmount } from './OpAmount';
import { SPACE, T, TAP } from './theme';

export function AmountPad({ visible, title, field, value, spent, onValue, onDone, onCancel }: {
  visible: boolean;
  /** The line's name — what is being changed. */
  title: string;
  /** 'Budgeted' or 'Available'. */
  field: string;
  value: number;
  /** Shown for context: the number that is NOT being edited moves too. */
  spent: number;
  onValue: (next: number) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      {/* Its own window: the app's safe area does not reach in here. */}
      <Pressable style={styles.backdrop} onPress={onCancel} testID="pad-backdrop">
        {/* Swallows the tap so a press inside does not dismiss. */}
        <Pressable style={[styles.card, { marginTop: insets.top + TAP }]} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Text style={styles.field}>{field}</Text>
          </View>

          <OpAmount value={value} onValue={onValue} autoFocus testID="pad-amount" />

          <View style={styles.foot}>
            <Text style={styles.spent} testID="pad-spent">{formatAmount(spent)} spent</Text>
            <Pressable onPress={onDone} style={styles.done} testID="pad-done">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000088' },
  card: {
    marginHorizontal: SPACE.lg, borderRadius: 14, padding: SPACE.lg, gap: SPACE.md,
    backgroundColor: T.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.sm },
  title: { color: T.gold, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  field: { color: T.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spent: { color: T.dim, fontSize: 13, fontVariant: ['tabular-nums'] },
  done: {
    minHeight: TAP, paddingHorizontal: SPACE.lg, justifyContent: 'center',
    borderRadius: 10, backgroundColor: T.accent,
  },
  doneText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
