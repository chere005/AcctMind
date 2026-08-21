/**
 * One budget line: its name, what is set aside, and what is left.
 *
 * Sean, 2026-08-21: "you can edit either the amount available, or the amount
 * budgeted, and it will adjust the other value appropriately." Both fields
 * are here and both are live — typing into one moves the other on the same
 * keystroke — because they are two views of ONE stored number. Only `budget`
 * is saved; `available` is `budget + spent`, and editing it is just another
 * way of saying what `budget` should be. See core/budget.ts.
 *
 * SPENT is shown and cannot be edited. It is the sum of the transactions
 * filed against this line, and a budget screen that let you type over the
 * money that actually moved would be a budget screen that lies.
 */
import { useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AMOUNT_OPS, applyOp, availableOf, budgetFor, cleanAmountText, formatAmount,
  parseAmount, type AmountOp,
} from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

export type LineDraft = { name: string; budget: number };

export function LineEditor({
  visible, title, name, budget, spent, onSave, onCancel, onDelete,
}: {
  visible: boolean;
  /** 'New line' or the category it sits in — what the bar says. */
  title: string;
  name: string;
  budget: number;
  /** The sum of this line's transactions. Read-only, and negative for spending. */
  spent: number;
  onSave: (draft: LineDraft) => void;
  onCancel: () => void;
  /** Absent when adding: there is nothing to remove yet. */
  onDelete?: (() => void) | undefined;
}) {
  const insets = useSafeAreaInsets();
  const [draftName, setDraftName] = useState(name);
  const [cents, setCents] = useState(budget);

  // Seeded on the transition rather than in an effect, so the first render
  // already has the right values and there is no frame showing the last
  // line's numbers. Same rule as the add form.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) { setDraftName(name); setCents(budget); }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} transparent={false}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.bar}>
            <Pressable onPress={onCancel} style={styles.barBtn} testID="line-cancel">
              <Text style={styles.barText}>Cancel</Text>
            </Pressable>
            <Text style={styles.barTitle} numberOfLines={1}>{title}</Text>
            <Pressable
              onPress={() => onSave({ name: draftName.trim(), budget: cents })}
              style={styles.barBtn}
              testID="line-save"
            >
              <Text style={[styles.barText, styles.barSave]}>Save</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <Text style={styles.label}>NAME</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              style={styles.input}
              placeholder="Produce"
              placeholderTextColor={T.faint}
              autoFocus={name === ''}
              testID="line-name"
            />

            <OpAmount
              label="BUDGETED"
              value={cents}
              onValue={setCents}
              testID="line-budget"
            />

            {/* Not a field. What has actually moved. */}
            <View style={styles.spentRow}>
              <Text style={styles.label}>SPENT</Text>
              <Text style={styles.spent} testID="line-spent">{formatAmount(spent)}</Text>
            </View>

            <OpAmount
              label="AVAILABLE"
              value={availableOf(cents, spent)}
              // The inverse, and the whole of the two-way edit: what you want
              // available says what has to be budgeted, given what has moved.
              onValue={(next) => setCents(budgetFor(next, spent))}
              testID="line-available"
            />

            {onDelete !== undefined && (
              <Pressable onPress={onDelete} style={styles.delete} testID="line-delete">
                <Text style={styles.deleteText}>Delete line</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * An amount with an operator in front of it.
 *
 * `=` replaces what is there, `+` adds, `-` subtracts. The typed text is kept
 * separately from the value, because half-finished input is not a number yet
 * and the field must not fight someone mid-keystroke — the same split the add
 * form's amount uses.
 *
 * The operator applies when the value is COMMITTED, not per keystroke: with
 * `+` and `2`,`5` typed, applying on every stroke would add 2 and then add 25
 * to the result. So the base is remembered when the operator is chosen and
 * every keystroke recomputes from THAT.
 */
function OpAmount({ label, value, onValue, testID }: {
  label: string;
  value: number;
  onValue: (next: number) => void;
  testID: string;
}) {
  const [op, setOp] = useState<AmountOp>('=');
  const [text, setText] = useState('');
  const [base, setBase] = useState(value);
  const [editing, setEditing] = useState(false);

  const start = (next: AmountOp) => {
    // The value as it stands when the operator is chosen is what `+` and `-`
    // work from, for the whole of that edit.
    if (!editing) setBase(value);
    setOp(next);
    setText('');
    setEditing(true);
  };

  const type = (raw: string) => {
    const clean = cleanAmountText(raw);
    setText(clean);
    /*
     * The FULL parser, not the entry rules, and the `.00` toggle does not
     * reach in here.
     *
     * The till rule — bare digits are cents, so `250` is $2.50 — exists for
     * someone tapping in the third coffee of the day. A budget is a
     * considered number typed once, where `250` plainly means two hundred and
     * fifty. The old Assigned field on the category manager already made this
     * distinction and said so; this is the same number, one level down.
     */
    const typed = parseAmount(clean);
    const from = editing ? base : value;
    if (typed === null) {
      // Nothing typed yet: `=` shows nothing and leaves the value alone until
      // there is something to replace it WITH.
      if (op !== '=') onValue(from);
      return;
    }
    const next = applyOp(from, op, typed);
    if (next !== null) onValue(next);
  };

  return (
    <View style={styles.opField}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.opRow}>
        {AMOUNT_OPS.map((o) => (
          <Pressable
            key={o}
            onPress={() => start(o)}
            style={[styles.op, editing && op === o && styles.opOn]}
            accessibilityRole="button"
            accessibilityLabel={o === '=' ? 'Set to' : o === '+' ? 'Add' : 'Subtract'}
            accessibilityState={{ selected: editing && op === o }}
            testID={`${testID}-op-${o === '=' ? 'set' : o === '+' ? 'add' : 'sub'}`}
          >
            <Text style={[styles.opText, editing && op === o && styles.opTextOn]}>
              {o === '-' ? '−' : o}
            </Text>
          </Pressable>
        ))}
        <TextInput
          // Editing shows what is being TYPED; at rest it shows the value.
          value={editing ? text : formatAmount(value)}
          onChangeText={type}
          onFocus={() => { if (!editing) start('='); }}
          style={styles.opInput}
          placeholder={formatAmount(value)}
          placeholderTextColor={T.faint}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          inputMode="text"
          testID={testID}
        />
      </View>
      {/* What it will be. Shown while typing, because with `+` and `-` the
          field holds the CHANGE and not the answer. */}
      {editing && (
        <Text style={styles.opResult} testID={`${testID}-result`}>{formatAmount(value)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  barBtn: { minHeight: TAP, minWidth: 72, justifyContent: 'center', paddingHorizontal: SPACE.sm },
  barText: { color: T.accent, fontSize: 16 },
  barSave: { fontWeight: '700', textAlign: 'right' },
  barTitle: { color: T.text, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  body: { padding: SPACE.lg, gap: SPACE.lg },
  label: { color: T.dim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: T.card, color: T.text, fontSize: 17, borderRadius: 10,
    paddingHorizontal: SPACE.md, paddingVertical: SPACE.md, minHeight: TAP,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  opField: { gap: SPACE.xs },
  opRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  // Drawn at TAP, like every control here — hitSlop is a no-op on the web.
  op: {
    width: TAP, height: TAP, borderRadius: TAP / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  opOn: { backgroundColor: T.accent, borderColor: T.accent },
  opText: { color: T.text, fontSize: 18, fontWeight: '700' },
  opTextOn: { color: '#ffffff' },
  opInput: {
    flex: 1, backgroundColor: T.card, color: T.text, fontSize: 17, borderRadius: 10,
    paddingHorizontal: SPACE.md, minHeight: TAP,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    fontVariant: ['tabular-nums'],
  },
  opResult: { color: T.dim, fontSize: 13, fontVariant: ['tabular-nums'] },
  spentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spent: { color: T.text, fontSize: 17, fontVariant: ['tabular-nums'] },
  delete: { minHeight: TAP, justifyContent: 'center', marginTop: SPACE.md },
  deleteText: { color: T.danger, fontSize: 16, fontWeight: '600' },
});
