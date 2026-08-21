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
  amountInput, amountIsNegative, cleanAmountText, draftOf, emptyDraft, entryCents,
  formatAmount, formatDay, isValid, toggleAmountSign, today, validateDraft,
  type AmountMode, type Category, type Draft, type DraftErrors, type Txn,
} from '@acctmind/core';
import { CategoryPick } from './CategoryPick';
import { DayPicker } from './DayPicker';
import { Toggle } from './Toggle';
import { SPACE, T, TAP } from './theme';

type Props = {
  visible: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
  /**
   * The transaction being edited, if this is an edit rather than an add.
   *
   * The form does not know what happens to what it returns — App decides
   * whether the draft becomes a new record or replaces an existing one. All
   * this changes here is what the fields start as and what the bar says.
   */
  editing?: Txn | undefined;
  /** The account a new transaction goes into — the section whose + was pressed. */
  account: string;
  /** Everything a transaction can be filed under. */
  categories: readonly Category[];
  /**
   * How bare digits are read. Owned by the screen behind this one, because it
   * is a setting that outlives any one entry — see TransactionsScreen.
   */
  mode: AmountMode;
};

export function AddTransaction({ visible, onSave, onCancel, editing, mode, account, categories }: Props) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(today(), account));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [picking, setPicking] = useState(false);
  /**
   * What has actually been typed, and how bare digits are read.
   *
   * Kept separately from `draft.amount`, which holds a CANONICAL string
   * (`-4.50`) that `validateDraft` and `parseAmount` understand without
   * knowing this screen exists. Two representations, one direction: typing
   * updates both, and core never sees the half-finished one.
   */
  const [amountText, setAmountText] = useState('');
  const insets = useSafeAreaInsets();

  // Opening is a fresh form, dated today. Computed on the transition rather
  // than in an effect, so the first render already has the right values and
  // there is no frame showing the last transaction's text.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      const start = editing === undefined ? emptyDraft(today(), account) : draftOf(editing);
      setDraft(start);
      setErrors({});
      setPicking(false);
      // The amount field is seeded from the CANONICAL string, not the raw
      // digits: '4.50' carries its own dot and so reads the same under either
      // entry mode. Seeding '450' would reopen an edit at $4.50 having saved
      // $450.00, or the reverse, depending on the toggle.
      setAmountText(cleanAmountText(start.amount));
    }
  }

  const set = (field: keyof Draft) => (text: string) => {
    setDraft((d) => ({ ...d, [field]: text }));
    // Clear a field's complaint as soon as it is touched — leaving it up
    // while someone fixes it reads as the app not noticing.
    setErrors((e) => (e[field] === undefined ? e : { ...e, [field]: undefined }));
  };

  /** Every route into the amount — the keys and the − button. */
  const setAmount = (rawText: string) => {
    const text = cleanAmountText(rawText);
    setAmountText(text);
    const cents = entryCents(text, mode);
    /*
     * There are two ways to have no amount, and they deserve different
     * sentences.
     *
     *  · Nothing typed, or only a sign or a dot -> an EMPTY draft amount, so
     *    core says "Amount is required". True of a field nobody has finished.
     *  · Digits that do not make an amount — `1.005`, which this app refuses
     *    to round — -> hand core the RAW text so `parseAmount` judges it and
     *    says "That is not an amount". Reporting that one as "required" would
     *    be telling someone who typed something that they typed nothing.
     *
     * When it IS an amount the draft gets the CANONICAL string, never the raw
     * text: `1234` in cents mode is $12.34, and `parseAmount('1234')` is
     * $1,234.00. Handing the raw text over would silently multiply by a
     * hundred at the last step.
     */
    const digits = /[0-9]/.test(text);
    setDraft((d) => ({
      ...d,
      amount: cents !== null ? amountInput(cents) : digits ? text : '',
    }));
    setErrors((e) => (e.amount === undefined ? e : { ...e, amount: undefined }));
  };

  const cents = entryCents(amountText, mode);

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
            <Text style={styles.barTitle}>
              {editing === undefined ? 'New Transaction' : 'Edit Transaction'}
            </Text>
            <Pressable onPress={submit} style={styles.barBtn} testID="save-button">
              <Text style={[styles.barText, styles.barSave]}>Save</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Field label="Name" error={errors.name}>
              <View style={styles.nameRow}>
              <TextInput
                value={draft.name}
                onChangeText={set('name')}
                style={[styles.input, styles.nameField]}
                placeholder="Coffee"
                placeholderTextColor={T.faint}
                autoFocus
                returnKeyType="next"
                testID="name-input"
              />
              {/*
                The date, as a calendar next to the name. It starts on today
                and most transactions are entered on the day they happen, so
                it earns a glyph rather than a field: the day it shows is the
                answer nearly every time, and it is one tap when it is not.
              */}
              <Pressable
                onPress={() => setPicking(true)}
                style={styles.calBtn}
                accessibilityRole="button"
                accessibilityLabel={`Date, ${formatDay(draft.date)}`}
                testID="date-button"
              >
                <CalendarIcon day={draft.date} />
              </Pressable>
              </View>
              <Text style={styles.dateUnder} testID="date-value">{formatDay(draft.date)}</Text>
            </Field>

            <Field label="Category">
              <CategoryPick
                categories={categories}
                value={draft.category}
                onPick={(id) => setDraft((d) => ({ ...d, category: id }))}
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
              <View style={styles.amountRow}>
                {/* Left of the field: the sign is read before the number,
                    so it is reached before the number too. */}
                <Toggle
                  label="−"
                  on={amountIsNegative(amountText)}
                  onPress={() => setAmount(toggleAmountSign(amountText))}
                  accessibilityLabel="Negative"
                  testID="sign-toggle"
                />
                <TextInput
                  /*
                   * The FORMATTED value, in the cell. The raw digits stay in
                   * `amountText` and are what the rules read; this is only
                   * what is drawn.
                   */
                  value={cents === null ? amountText : formatAmount(cents)}
                  onChangeText={(next) => {
                    /*
                     * Two kinds of text arrive here and they mean different
                     * things.
                     *
                     * Editing what is DRAWN — the value carries a '$', because
                     * that is what `formatAmount` puts there — is a digit
                     * gesture: typing appends a digit and backspace removes
                     * one, and the dot on screen is punctuation this code
                     * added, not something the person typed. Reading it as a
                     * decimal point would make every keystroke past two
                     * decimals a refusal.
                     *
                     * Anything without a '$' is raw: typed before formatting
                     * caught up, or pasted. There the dot is REAL and its
                     * POSITION is the whole meaning — `12.3` is $12.30 and
                     * `1.005` is refused, and both must survive the trip.
                     */
                    const digits = next.replace(/[^0-9]/g, '');
                    const neg = next.trimStart().startsWith('-');
                    const dot = next.indexOf('.');
                    const raw = next.includes('$') || dot < 0
                      ? digits + (next.trimEnd().endsWith('.') ? '.' : '')
                      : (() => {
                          const after = next.slice(dot + 1).replace(/[^0-9]/g, '').length;
                          const cut = digits.length - after;
                          return digits.slice(0, cut) + '.' + digits.slice(cut);
                        })();
                    setAmount((neg ? '-' : '') + raw);
                  }}
                  style={[styles.input, styles.amountField]}
                  placeholder={mode === 'whole' ? '0' : '0.00'}
                  placeholderTextColor={T.faint}
                  // 'decimal-pad' has no minus sign, and a leading '-' is
                  // still a supported way to enter an expense even though the
                  // − button exists. Both, not either.
                  keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                  inputMode="text"
                  testID="amount-input"
                />
              </View>
              {/* Kept for the tests and the screen reader: the cell shows the
                  amount now, so this is the same string, not a second one. */}
              <Text
                style={styles.previewHidden}
                accessibilityElementsHidden
                testID="amount-preview"
              >
                {cents === null ? '' : formatAmount(cents)}
              </Text>
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

/** A little calendar showing the day it will file the transaction under. */
function CalendarIcon({ day }: { day: string }) {
  return (
    <View style={styles.cal}>
      <View style={styles.calTop} />
      <Text style={styles.calDay}>{Number(day.slice(8, 10))}</Text>
    </View>
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  nameField: { flex: 1 },
  calBtn: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  cal: {
    width: 26, height: 26, borderRadius: 5, overflow: 'hidden',
    borderWidth: 1.5, borderColor: T.dim, alignItems: 'center', justifyContent: 'flex-end',
  },
  calTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: T.dim },
  calDay: { color: T.text, fontSize: 13, fontWeight: '700', lineHeight: 17 },
  dateUnder: { color: T.dim, fontSize: 13 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  amountField: { flex: 1 },
  // A non-breaking space holds the line's height when there is nothing to
  // show, so the form does not jump on the first keystroke.
  previewHidden: { height: 0, opacity: 0 },
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
