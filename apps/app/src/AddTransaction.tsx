/**
 * The add form: Name, Description, Amount, and a button that picks the Date.
 *
 * The form holds a `Draft` — four raw strings — and asks core whether it is
 * any good. It never decides that itself: `validateDraft` and `parseAmount`
 * are the same functions the (future) native surfaces call, so "what counts
 * as an amount" has exactly one answer.
 */
import { useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  emptyDraft, formatDay, isValid, today, validateDraft,
  type Draft, type DraftErrors,
} from '@acctmind/core';
import { DayPicker } from './DayPicker';
import { SPACE, T, TAP } from './theme';

type Props = {
  visible: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
};

export function AddTransaction({ visible, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(today()));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [picking, setPicking] = useState(false);
  const insets = useSafeAreaInsets();

  // Opening is a fresh form, dated today. Computed on the transition rather
  // than in an effect, so the first render already has the right values and
  // there is no frame showing the last transaction's text.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(emptyDraft(today()));
      setErrors({});
      setPicking(false);
    }
  }

  const set = (field: keyof Draft) => (text: string) => {
    setDraft((d) => ({ ...d, [field]: text }));
    // Clear a field's complaint as soon as it is touched — leaving it up
    // while someone fixes it reads as the app not noticing.
    setErrors((e) => (e[field] === undefined ? e : { ...e, [field]: undefined }));
  };

  const submit = () => {
    const found = validateDraft(draft);
    setErrors(found);
    // Every bad field at once. A form that reports one at a time costs a
    // round trip per mistake.
    if (isValid(found)) onSave(draft);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} transparent={false}>
      {/* Its own window: the app's safe area does not reach in here. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.bar}>
            <Pressable onPress={onCancel} style={styles.barBtn} testID="cancel-button">
              <Text style={styles.barText}>Cancel</Text>
            </Pressable>
            <Text style={styles.barTitle}>New Transaction</Text>
            <Pressable onPress={submit} style={styles.barBtn} testID="save-button">
              <Text style={[styles.barText, styles.barSave]}>Save</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Field label="Name" error={errors.name}>
              <TextInput
                value={draft.name}
                onChangeText={set('name')}
                style={styles.input}
                placeholder="Coffee"
                placeholderTextColor={T.faint}
                autoFocus
                returnKeyType="next"
                testID="name-input"
              />
            </Field>

            <Field label="Description" error={errors.description}>
              <TextInput
                value={draft.description}
                onChangeText={set('description')}
                style={[styles.input, styles.multiline]}
                placeholder="Optional"
                placeholderTextColor={T.faint}
                multiline
                testID="description-input"
              />
            </Field>

            <Field label="Amount" error={errors.amount}>
              <TextInput
                value={draft.amount}
                onChangeText={set('amount')}
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor={T.faint}
                // 'decimal-pad' has no minus sign. A ledger needs negatives,
                // and core accepts '-5' and the accounting '(5)', so the
                // keyboard must be able to type them.
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                inputMode="text"
                testID="amount-input"
              />
            </Field>

            <Field label="Date" error={errors.date}>
              <Pressable
                onPress={() => setPicking(true)}
                style={[styles.input, styles.dateBtn]}
                testID="date-button"
              >
                {/* The value carries its own testID: the button also holds
                    the 'Change' hint, and a text assertion on the whole
                    control has to fight whitespace normalization. */}
                <Text style={styles.dateText} testID="date-value">{formatDay(draft.date)}</Text>
                <Text style={styles.dateHint}>Change</Text>
              </Pressable>
            </Field>
          </ScrollView>

          <DayPicker
            visible={picking}
            value={draft.date}
            onPick={(day) => { set('date')(day); setPicking(false); }}
            onCancel={() => setPicking(false)}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, error, children }: {
  label: string; error?: string | undefined; children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error !== undefined && (
        <Text style={styles.error} testID={`error-${label.toLowerCase()}`}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.sm, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.cardEdge,
  },
  barBtn: { minHeight: TAP, minWidth: 72, justifyContent: 'center', paddingHorizontal: SPACE.sm },
  barText: { color: T.accent, fontSize: 16 },
  barSave: { fontWeight: '700', textAlign: 'right' },
  barTitle: { color: T.text, fontSize: 17, fontWeight: '600' },
  body: { padding: SPACE.lg, gap: SPACE.lg },
  field: { gap: SPACE.xs },
  label: { color: T.dim, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: T.card, color: T.text, fontSize: 17, borderRadius: 10,
    paddingHorizontal: SPACE.md, paddingVertical: SPACE.md, minHeight: TAP,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  multiline: { minHeight: TAP * 2, textAlignVertical: 'top' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateText: { color: T.text, fontSize: 17 },
  dateHint: { color: T.accent, fontSize: 15 },
  error: { color: T.danger, fontSize: 13 },
});
