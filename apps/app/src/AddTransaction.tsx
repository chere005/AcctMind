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
  amountDigits, amountInput, draftOf, emptyDraft, formatAmount, formatDay, isValid,
  signedCents, today, validateDraft,
  type AmountMode, type Category, type Draft, type DraftErrors, type Line, type Txn,
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
  /** The category it starts filed under, when the + that opened this knew one. */
  category?: string | null | undefined;
  /** The categories, for the picker's grouping and colours. */
  categories: readonly Category[];
  /** Everything a transaction can be filed under — the LINES, since v4. */
  lines: readonly Line[];
  /**
   * How bare digits are read. Owned by the screen behind this one, because it
   * is a setting that outlives any one entry — see TransactionsScreen.
   */
  mode: AmountMode;
};

export function AddTransaction({
  visible, onSave, onCancel, editing, mode, account, category = null, categories, lines,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(today(), account, category));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [picking, setPicking] = useState(false);
  /**
   * What has actually been typed, and the sign held beside it.
   *
   * TWO pieces of state, not one string with a `-` on the front. Sean,
   * 2026-08-21: "don't show the - in the input field and only allow numbers
   * to be typed." The field draws digits; the − button draws the sign; core's
   * `signedCents` is the only place they meet.
   *
   * Both kept separately from `draft.amount`, which holds a CANONICAL string
   * (`-4.50`) that `validateDraft` and `parseAmount` understand without
   * knowing this screen exists. Two representations, one direction: typing
   * updates both, and core never sees the half-finished one.
   */
  const [digits, setDigits] = useState('');
  const [negative, setNegative] = useState(true);
  const insets = useSafeAreaInsets();

  // Opening is a fresh form, dated today. Computed on the transition rather
  // than in an effect, so the first render already has the right values and
  // there is no frame showing the last transaction's text.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      const start = editing === undefined
        ? emptyDraft(today(), account, category)
        : draftOf(editing);
      setDraft(start);
      setErrors({});
      setPicking(false);
      /*
       * A NEW transaction starts negative — Sean, 2026-08-21.
       *
       * Almost everything in a ledger is money going out; income is a handful
       * of rows a month. Starting positive means tapping − on nearly every
       * entry, and the one that gets forgotten is a payment recorded as
       * income, which is wrong by twice its own size.
       *
       * A lone '-' is not an amount, so the form still says "Amount is
       * required" until something is typed — the sign is a default, not a
       * value.
       *
       * An EDIT is seeded from the canonical string instead: '4.50' carries
       * its own dot and so reads the same under either entry mode, where
       * '450' would reopen at $4.50 having saved $450.00.
       */
      setDigits(amountDigits(start.amount));
      setNegative(editing === undefined ? true : start.amount.trimStart().startsWith('-'));
    }
  }

  const set = (field: keyof Draft) => (text: string) => {
    setDraft((d) => ({ ...d, [field]: text }));
    // Clear a field's complaint as soon as it is touched — leaving it up
    // while someone fixes it reads as the app not noticing.
    setErrors((e) => (e[field] === undefined ? e : { ...e, [field]: undefined }));
  };

  /** Every route into the amount — the keys and the − button. */
  const setAmount = (rawText: string, sign: boolean) => {
    const text = amountDigits(rawText);
    setDigits(text);
    setNegative(sign);
    const cents = signedCents(text, sign, mode);
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
    const anyDigits = /[0-9]/.test(text);
    setDraft((d) => ({
      ...d,
      amount: cents !== null ? amountInput(cents) : anyDigits ? text : '',
    }));
    setErrors((e) => (e.amount === undefined ? e : { ...e, amount: undefined }));
  };

  const cents = signedCents(digits, negative, mode);

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
                /*
                 * Return SAVES — Sean, 2026-08-21, from the Mac.
                 *
                 * On a keyboard the form is three fields and a button, and
                 * reaching for the mouse to finish something you have just
                 * typed is the slowest part of entering a transaction. It was
                 * `next`, which on a desktop does nothing anyone asked for.
                 *
                 * Wired the same on every surface rather than only on the
                 * one that asked. Six surfaces disagreeing about what Return
                 * does is a rule written five different ways; and on a phone
                 * "done" is a better key than "next" here anyway, because the
                 * amount is the only field left and it opens its own keypad.
                 */
                returnKeyType="done"
                onSubmitEditing={submit}
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
                {/* The date reads INSIDE the button that changes it. It used
                    to be a line of dim text under the whole field — an
                    unlabelled `Aug 21` floating below the name box, which is
                    a thing to wonder about rather than a thing to read. Next
                    to the icon it is the button's own caption. */}
                <Text style={styles.calDate} testID="date-value">{formatDay(draft.date)}</Text>
              </Pressable>
              </View>
            </Field>

            <Field label="Category">
              <CategoryPick
                categories={categories}
                lines={lines}
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
                  on={negative}
                  onPress={() => setAmount(digits, !negative)}
                  accessibilityLabel="Negative"
                  testID="sign-toggle"
                />
                <TextInput
                  /*
                   * The FORMATTED value, in the cell, and UNSIGNED — the − to
                   * the left of it is what says negative. `formatAmount` puts
                   * a minus on a negative, so the sign is taken off again
                   * here rather than drawn twice.
                   *
                   * The raw digits stay in `digits` and are what the rules
                   * read; this is only what is drawn.
                   */
                  value={cents === null ? digits : formatAmount(Math.abs(cents))}
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
                    const only = next.replace(/[^0-9]/g, '');
                    const dot = next.indexOf('.');
                    const raw = next.includes('$') || dot < 0
                      ? only + (next.trimEnd().endsWith('.') ? '.' : '')
                      : (() => {
                          const after = next.slice(dot + 1).replace(/[^0-9]/g, '').length;
                          const cut = only.length - after;
                          return only.slice(0, cut) + '.' + only.slice(cut);
                        })();
                    // The sign is not typed and is not read back out of the
                    // text: it rides along untouched from the button.
                    setAmount(raw, negative);
                  }}
                  style={[styles.input, styles.amountField]}
                  placeholder={mode === 'whole' ? '0' : '0.00'}
                  placeholderTextColor={T.faint}
                  // A NUMBER pad, which has no minus key — and now that the
                  // sign lives entirely in the − button, a minus key would be
                  // one that does nothing. The note that used to sit here
                  // said the opposite, back when a leading '-' was a second
                  // supported way to enter an expense.
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  returnKeyType="done"
                  onSubmitEditing={submit}
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
  calBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    minHeight: TAP, paddingHorizontal: SPACE.sm, borderRadius: 10,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  calDate: { color: T.text, fontSize: 14, fontWeight: '600' },
  cal: {
    width: 26, height: 26, borderRadius: 5, overflow: 'hidden',
    borderWidth: 1.5, borderColor: T.dim, alignItems: 'center', justifyContent: 'flex-end',
  },
  calTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: T.dim },
  calDay: { color: T.text, fontSize: 13, fontWeight: '700', lineHeight: 17 },
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
