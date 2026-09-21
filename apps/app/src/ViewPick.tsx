/**
 * `View:` — which budget SET the Budget tab is reading.
 *
 * Sean, 2026-09-16: "Add 'View: ' [Dropdown menu] under Budget.. from that
 * menu you can pick month... another dropdown option is All Time... last
 * entry is 'New View' which will bring up a floating dialog asking for the
 * name of the view.. in this view, budget changes are unique to that view
 * only."
 *
 * Deliberately `SortPick`'s menu — same modal, same rows, same tick — because
 * this screen already has that gesture and two dropdowns that open
 * differently in one app is a thing a person notices without being able to
 * say why. What it adds is a LAST ROW that is not a choice but an action, cut
 * off from the list above it by its own divider so it cannot be mistaken for
 * one more view to pick.
 *
 * The naming dialog lives here rather than on the screen: it exists only to
 * finish this menu's last row, and a floating field the screen owns would be
 * a second thing to keep in step with the menu that opens it.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { View as BudgetView } from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

/** The two that are not a saved view. Kept as ids so `picked` is one string. */
export const ALL_VIEW = 'all';
export const MONTH_VIEW = 'month';

export function ViewPick({ picked, views, onPick, onNew }: {
  /** 'all', 'month', or a view's id. */
  picked: string;
  views: readonly BudgetView[];
  onPick: (id: string) => void;
  onNew: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  const label =
    picked === ALL_VIEW ? 'All Time'
      : picked === MONTH_VIEW ? 'Month'
        // An id with no view left behind it reads as Month, which is what
        // the screen falls back to and what a fresh device opens on.
        : views.find((v) => v.id === picked)?.name ?? 'Month';

  const rows: [string, string][] = [
    [MONTH_VIEW, 'Month'],
    [ALL_VIEW, 'All Time'],
    ...views.map((v): [string, string] => [v.id, v.name]),
  ];

  return (
    <>
      <View style={styles.row}>
        <Text style={styles.label}>View:</Text>
        <Pressable
          onPress={() => setOpen(true)}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={`View: ${label}`}
          testID="budget-view-pick"
        >
          <Text style={styles.buttonText} numberOfLines={1} testID="budget-view-label">{label}</Text>
          <Text style={styles.chev}>⌄</Text>
        </Pressable>
      </View>

      {open && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} testID="budget-view-backdrop">
            <Pressable style={[styles.menu, { marginTop: insets.top + TAP * 2 }]} onPress={() => {}}>
              {rows.map(([id, name]) => (
                <Pressable
                  key={id}
                  onPress={() => { onPick(id); setOpen(false); }}
                  style={styles.menuRow}
                  accessibilityRole="button"
                  accessibilityState={{ selected: picked === id }}
                  testID={`budget-view-${id}`}
                >
                  <Text style={[styles.rowText, picked === id && styles.rowOn]}>{name}</Text>
                  {picked === id && <Text style={styles.tick}>✓</Text>}
                </Pressable>
              ))}
              {/* An ACTION, not a choice — heavier rule above it and no tick
                  can ever appear beside it. */}
              <Pressable
                onPress={() => { setOpen(false); setNaming(''); }}
                style={[styles.menuRow, styles.last, styles.action]}
                accessibilityRole="button"
                testID="budget-view-new"
              >
                <Text style={styles.actionText}>New View…</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {naming !== null && (
        <Modal transparent animationType="fade" onRequestClose={() => setNaming(null)}>
          <Pressable style={styles.backdrop} onPress={() => setNaming(null)} testID="budget-view-name-backdrop">
            <Pressable style={[styles.dialog, { marginTop: insets.top + TAP * 3 }]} onPress={() => {}}>
              <Text style={styles.dialogTitle}>New view</Text>
              <Text style={styles.dialogNote}>
                Its own budgeted amounts. Changing one here changes nothing anywhere else.
              </Text>
              <TextInput
                value={naming}
                onChangeText={setNaming}
                placeholder="Name"
                placeholderTextColor={T.faint}
                autoFocus
                style={styles.field}
                onSubmitEditing={() => {
                  const name = naming.trim();
                  setNaming(null);
                  if (name !== '') onNew(name);
                }}
                testID="budget-view-name-input"
              />
              <View style={styles.dialogRow}>
                <Pressable onPress={() => setNaming(null)} style={styles.btn} testID="budget-view-name-cancel">
                  <Text style={styles.btnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const name = naming.trim();
                    setNaming(null);
                    // An empty name makes no view. Nothing to undo, nothing
                    // to explain — the dialog simply closes.
                    if (name !== '') onNew(name);
                  }}
                  style={[styles.btn, styles.btnGo]}
                  testID="budget-view-name-ok"
                >
                  <Text style={[styles.btnText, styles.btnGoText]}>Create</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // SHRINKABLE, since 2026-09-21: the month stepper shares this row now, and
  // it cannot give — its arrows are 44pt targets and its name is tabular so
  // the arrows hold still. A long view name is what has to ellipsize.
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, flexShrink: 1, minWidth: 0 },
  label: { color: T.dim, fontSize: 15, flexShrink: 0 },
  button: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: TAP, flexShrink: 1, minWidth: 0 },
  buttonText: { color: T.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  chev: { color: T.dim, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#00000088' },
  menu: {
    marginHorizontal: SPACE.lg, borderRadius: 14,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
    minHeight: TAP, paddingHorizontal: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  last: { borderBottomWidth: 0 },
  action: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.cardEdge },
  actionText: { color: T.accent, fontSize: 16, flex: 1 },
  rowText: { color: T.text, fontSize: 16, flex: 1 },
  rowOn: { fontWeight: '700' },
  tick: { color: T.accent, fontSize: 16, fontWeight: '700' },
  dialog: {
    marginHorizontal: SPACE.lg, borderRadius: 14, padding: SPACE.lg, gap: SPACE.sm,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  dialogTitle: { color: T.text, fontSize: 17, fontWeight: '700' },
  dialogNote: { color: T.dim, fontSize: 13, lineHeight: 18 },
  field: {
    color: T.text, fontSize: 16, minHeight: TAP,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  dialogRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACE.sm, marginTop: SPACE.xs },
  btn: { minHeight: TAP, justifyContent: 'center', paddingHorizontal: SPACE.md, borderRadius: 10 },
  btnText: { color: T.dim, fontSize: 16 },
  btnGo: { backgroundColor: T.accent },
  btnGoText: { color: '#ffffff', fontWeight: '700' },
});
