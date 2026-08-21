/**
 * Where accounts and categories are made, named, coloured and removed.
 *
 * One screen for both, because they are the same record with a different
 * word in front of it — and because the ONLY way to create either is here.
 * Scattering "new account" across the screens that use accounts is how two
 * of them end up disagreeing about what a new one starts as.
 */
import { useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PALETTE, amountInput, formatAmount, parseAmount } from '@acctmind/core';
import { Dot } from './Dot';
import { SPACE, T, TAP } from './theme';

export type ManageRow = {
  id: string;
  name: string;
  color: string;
  /** Categories carry assigned money; accounts do not. */
  budget?: number | undefined;
};

export function Manage({ visible, label, rows, onClose, onAdd, onChange, onDelete }: {
  visible: boolean;
  /** "Accounts" or "Categories". */
  label: string;
  rows: readonly ManageRow[];
  onClose: () => void;
  onAdd: () => void;
  onChange: (row: ManageRow) => void;
  onDelete: (row: ManageRow) => void;
}) {
  const insets = useSafeAreaInsets();
  const single = label.replace(/ies$/, 'y').replace(/s$/, '');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Its own window: the app's safe area does not reach in here. */}
      <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Text style={styles.title} testID="manage-title">{label}</Text>
          <Pressable onPress={onClose} style={styles.barBtn} testID="manage-done">
            <Text style={styles.barText}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {rows.map((row) => (
            <Item key={row.id} row={row} onChange={onChange} onDelete={onDelete} />
          ))}

          <Pressable onPress={onAdd} style={styles.add} testID="manage-add">
            <Text style={styles.addText}>New {single}</Text>
          </Pressable>

          {rows.length === 1 && (
            <Text style={styles.note}>
              The last {single.toLowerCase()} cannot be removed — every transaction
              has to live somewhere.
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Item({ row, onChange, onDelete }: {
  row: ManageRow;
  onChange: (row: ManageRow) => void;
  onDelete: (row: ManageRow) => void;
}) {
  const [swatch, setSwatch] = useState(false);
  const money = row.budget !== undefined;

  return (
    <View style={styles.item} testID={`manage-row-${row.id}`}>
      <View style={styles.itemTop}>
        <Pressable
          onPress={() => setSwatch(!swatch)}
          style={styles.swatchBtn}
          accessibilityLabel="Colour"
          testID={`manage-color-${row.id}`}
        >
          <Dot colors={[row.color]} size={18} />
        </Pressable>
        <TextInput
          value={row.name}
          onChangeText={(name) => onChange({ ...row, name })}
          style={styles.name}
          placeholder="Name"
          placeholderTextColor={T.faint}
          testID={`manage-name-${row.id}`}
        />
        <Pressable
          onPress={() => onDelete(row)}
          style={styles.del}
          accessibilityLabel="Delete"
          testID={`manage-delete-${row.id}`}
        >
          <Text style={styles.delText}>Delete</Text>
        </Pressable>
      </View>

      {swatch && (
        <View style={styles.tray}>
          {PALETTE.map((hex) => (
            <Pressable
              key={hex}
              onPress={() => { onChange({ ...row, color: hex }); setSwatch(false); }}
              style={[styles.trayDot, { backgroundColor: hex }, hex === row.color && styles.trayOn]}
              testID={`manage-swatch-${hex.slice(1)}`}
            />
          ))}
        </View>
      )}

      {money && (
        <View style={styles.budgetRow}>
          <Text style={styles.budgetLabel}>Assigned</Text>
          <TextInput
            defaultValue={row.budget === 0 ? '' : amountInput(row.budget ?? 0)}
            onChangeText={(text) => {
              // The full parser, not the entry rules: this is a considered
              // number typed once, not a running total tapped in at a till.
              const cents = parseAmount(text);
              if (cents !== null) onChange({ ...row, budget: cents });
              if (text.trim() === '') onChange({ ...row, budget: 0 });
            }}
            style={styles.budget}
            placeholder={formatAmount(0)}
            placeholderTextColor={T.faint}
            inputMode="text"
            testID={`manage-budget-${row.id}`}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm,
  },
  title: { color: T.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  barBtn: { minHeight: TAP, minWidth: TAP, justifyContent: 'center', alignItems: 'flex-end' },
  barText: { color: T.accent, fontSize: 17 },
  body: { padding: SPACE.lg, gap: SPACE.md },
  item: {
    backgroundColor: T.card, borderRadius: 12, padding: SPACE.md, gap: SPACE.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  swatchBtn: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: T.text, fontSize: 17, minHeight: TAP },
  del: { minHeight: TAP, justifyContent: 'center', paddingHorizontal: SPACE.sm },
  delText: { color: T.danger, fontSize: 15 },
  tray: { flexDirection: 'row', gap: SPACE.md, paddingVertical: SPACE.sm, paddingLeft: SPACE.sm },
  trayDot: { width: 26, height: 26, borderRadius: 13 },
  trayOn: { borderWidth: 2, borderColor: T.text },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  budgetLabel: { color: T.dim, fontSize: 14, width: 74 },
  budget: {
    flex: 1, minHeight: TAP, color: T.text, fontSize: 17,
    backgroundColor: T.field, borderRadius: 10, paddingHorizontal: SPACE.md,
  },
  add: {
    minHeight: TAP, alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, backgroundColor: T.card,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  addText: { color: T.accent, fontSize: 16, fontWeight: '600' },
  note: { color: T.dim, fontSize: 13, lineHeight: 19 },
});
