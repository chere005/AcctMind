/**
 * An amount with `=`, `+` and `−` under it.
 *
 * Sean, 2026-08-21: tapping a budget amount offers the three, and the buttons
 * sit UNDERNEATH the field. `=` replaces what is there, `+` adds what you
 * type, `−` takes it away.
 *
 * Why an operator rather than just editing the number: a budget is adjusted
 * far more often than it is set. "Twenty more for groceries" is the actual
 * thought, and making someone read the current value, add twenty in their
 * head and type the total is asking them to do arithmetic the app is holding
 * all the inputs for — which is also the arithmetic they will get wrong. That
 * is why `+` is the DEFAULT: adjusting is the common case, and setting is the
 * one worth a deliberate tap.
 *
 * One component, used by the pad on the Budget page and by the line editor,
 * because two copies of a rule about money is two chances for them to drift.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AMOUNT_OPS, applyOp, cleanAmountText, formatAmount, parseAmount, type AmountOp } from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

export function OpAmount({
  label, value, onValue, testID, autoFocus = false, defaultOp = '+', onSubmit, compact = false,
}: {
  /** What this amount is. Omit for the pad, where the card's title says it. */
  label?: string | undefined;
  value: number;
  onValue: (next: number) => void;
  testID: string;
  autoFocus?: boolean;
  defaultOp?: AmountOp;
  /** Return on the keyboard. The pad commits; the editor has its own Save. */
  onSubmit?: (() => void) | undefined;
  /**
   * The pad's size: small buttons, a smaller field, no label.
   *
   * The buttons are drawn at 32 in a 36 target rather than this app's usual
   * 44. Sean asked for "3 small buttons" in a box that is deliberately tiny,
   * and three 44s plus the running total do not fit a box narrow enough to
   * sit under one column. It is the same exception the row action cluster
   * takes, for the same reason: the container is smaller than the guideline.
   */
  compact?: boolean;
}) {
  const [op, setOp] = useState<AmountOp>(defaultOp);
  const [text, setText] = useState('');
  const [base, setBase] = useState(value);
  const [editing, setEditing] = useState(false);

  const start = (next: AmountOp) => {
    // The value as it stands when the operator is chosen is what `+` and `−`
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
    <View style={compact ? styles.fieldCompact : styles.field}>
      {label !== undefined && <Text style={styles.label}>{label}</Text>}
      <TextInput
        // Editing shows what is being TYPED; at rest it shows the value.
        value={editing ? text : formatAmount(value)}
        onChangeText={type}
        onFocus={() => { if (!editing) start(defaultOp); }}
        style={[styles.input, compact && styles.inputCompact]}
        placeholder={formatAmount(value)}
        placeholderTextColor={T.faint}
        autoFocus={autoFocus}
        selectTextOnFocus
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        inputMode="text"
        returnKeyType={onSubmit === undefined ? 'default' : 'done'}
        onSubmitEditing={onSubmit}
        testID={testID}
      />
      {/* UNDERNEATH the field — Sean's placement. */}
      <View style={styles.ops}>
        {AMOUNT_OPS.map((o) => (
          <Pressable
            key={o}
            onPress={() => start(o)}
            style={[styles.op, compact && styles.opCompact, editing && op === o && styles.opOn]}
            accessibilityRole="button"
            accessibilityLabel={o === '=' ? 'Set to' : o === '+' ? 'Add' : 'Subtract'}
            accessibilityState={{ selected: editing && op === o }}
            testID={`${testID}-op-${o === '=' ? 'set' : o === '+' ? 'add' : 'sub'}`}
          >
            <Text style={[
              styles.opText, compact && styles.opTextCompact,
              editing && op === o && styles.opTextOn,
            ]}>
              {o === '-' ? '−' : o}
            </Text>
          </Pressable>
        ))}
        {/* What it will BE. With `+` and `−` the field holds the change and
            not the answer, so without this you are doing the sum yourself —
            which is the thing the operator exists to avoid. */}
        <Text
          style={[styles.result, compact && styles.resultCompact]}
          numberOfLines={1}
          testID={`${testID}-result`}
        >
          {editing ? formatAmount(value) : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: SPACE.sm },
  fieldCompact: { gap: SPACE.xs },
  label: { color: T.dim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    // T.card on whatever holds it, never T.field. Pure black inside a grey
    // card reads as a hole punched in it rather than as somewhere to type —
    // the same mistake the add form's Category box had, made again here and
    // caught on a simulator rather than by anything in the suite.
    backgroundColor: T.card, color: T.text, fontSize: 20, borderRadius: 10,
    paddingHorizontal: SPACE.md, minHeight: TAP,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    fontVariant: ['tabular-nums'],
  },
  ops: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  inputCompact: { fontSize: 17, minHeight: 38, paddingHorizontal: SPACE.sm },
  opCompact: { width: 36, height: 36, borderRadius: 18 },
  opTextCompact: { fontSize: 16 },
  resultCompact: { fontSize: 13 },
  // Drawn at TAP, like every control in this app — hitSlop is a no-op on web.
  op: {
    width: TAP, height: TAP, borderRadius: TAP / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  opOn: { backgroundColor: T.accent, borderColor: T.accent },
  opText: { color: T.text, fontSize: 18, fontWeight: '700' },
  opTextOn: { color: '#ffffff' },
  result: {
    color: T.text, fontSize: 15, flex: 1, textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
