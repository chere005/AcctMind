/**
 * Importing a bank CSV.
 *
 * Sean, 2026-09-15: a button that takes a Wells Fargo checking export and
 * files the lines that are not already here. Every decision about what a line
 * MEANS is in `packages/core/src/csv.ts` — this screen picks a file, shows
 * what would happen, and waits to be told to do it.
 *
 * It shows the plan BEFORE writing anything, and that is the whole design.
 * An import that reports what it did after doing it is an import you have to
 * undo, and the undo for 1,952 rows is restoring a backup nobody took.
 *
 * A SECOND EXPORT OF THE SAME DAYS is the bank changing its mind out loud —
 * Sean, 2026-09-18 — so the plan has three parts now, not one: rows to add,
 * rows the file has CHANGED (a pending charge that settled, one that has now
 * cleared), and rows inside the file's own days that it no longer has at all.
 * The arithmetic is `reconcileRows` in core; what is here is showing them,
 * and making the removals take a second press.
 *
 * ON PICKING A FILE: there is no `expo-document-picker` here, deliberately —
 * it is a native dependency for a feature that is mostly used at a desk. Web
 * and the Tauri desktop shells (which ARE the web build) get a real file
 * input; iOS and Android get a paste box, because pasting a CSV into a text
 * field works on every platform and needs nothing installed. If someone ever
 * wants a phone file picker, the dependency goes in then and this screen
 * grows one branch.
 */
import { useEffect, useState } from 'react';
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatAmount, planImport, readCsv, wellsFargoName,
  type Account, type CsvProblem, type CsvRow, type ImportMode, type ImportPlan, type Store,
} from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

/** What the file turned into, before anyone has agreed to file it. */
type Loaded = {
  name: string;
  rows: readonly CsvRow[];
  problems: readonly CsvProblem[];
  /** Read fine and left out on purpose — voided rows. Reported apart from
   *  `problems`, because "we skipped these" and "these are broken" are not
   *  the same sentence and one of them is alarming. */
  skipped: readonly CsvProblem[];
};

export function Import({ visible, store, accounts, onClose, onImport }: {
  visible: boolean;
  store: Store;
  accounts: readonly Account[];
  onClose: () => void;
  onImport: (account: string, rows: readonly CsvRow[], mode: ImportMode) => void;
}) {
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** `replace` is armed by a first press, like the budget's delete. */
  const [armed, setArmed] = useState(false);
  /** …and so is the ordinary import, but ONLY when it would remove a row. */
  const [armedAdd, setArmedAdd] = useState(false);

  // Opening is a fresh screen. A file left over from last time, sitting under
  // a button that says Import, is the shape of a mistake nobody can see.
  useEffect(() => {
    if (!visible) return;
    setLoaded(null);
    setPasted('');
    setError(null);
    setArmed(false);
    setArmedAdd(false);
    setAccount((a) => a ?? accounts[0]?.id ?? null);
  }, [visible, accounts]);

  const take = (name: string, text: string) => {
    const read = readCsv(text);
    setError(read.rows.length === 0 ? 'No transactions found in that file.' : null);
    setLoaded({ name, rows: read.rows, problems: read.problems, skipped: read.skipped });
    setArmed(false);
    setArmedAdd(false);
  };

  const plan = loaded === null || account === null
    ? null
    : planImport(store, account, loaded.rows, 'add');
  const replacing = loaded === null || account === null
    ? null
    : planImport(store, account, loaded.rows, 'replace');

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Text style={styles.title} testID="import-title">Import CSV</Text>
          <Pressable onPress={onClose} style={styles.barBtn} testID="import-close">
            <Text style={styles.barBtnText}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.help}>
            A bank export with DATE, DESCRIPTION and AMOUNT columns. The bank&apos;s own
            text is kept on every row, so an import can always be checked against the
            statement it came from.
          </Text>

          {/* The file input is a real one on web, which is also both desktop
              shells. `as never` because react-native-web passes unknown props
              through to the DOM node and RN's types cannot describe that. */}
          {Platform.OS === 'web' ? (
            <View style={styles.pick}>
              {/* eslint-disable-next-line */}
              {createFileInput(take)}
            </View>
          ) : (
            <>
              <Text style={styles.label}>Paste the CSV</Text>
              <TextInput
                value={pasted}
                onChangeText={setPasted}
                style={styles.paste}
                multiline
                placeholder={'"DATE","DESCRIPTION","AMOUNT"…'}
                placeholderTextColor={T.faint}
                testID="import-paste"
              />
              <Pressable
                onPress={() => take('pasted', pasted)}
                style={styles.btn}
                accessibilityRole="button"
                testID="import-read-paste"
              >
                <Text style={styles.btnText}>Read it</Text>
              </Pressable>
            </>
          )}

          {error !== null && <Text style={styles.error} testID="import-error">{error}</Text>}

          {loaded !== null && loaded.rows.length > 0 && (
            <>
              <Text style={styles.label}>Into which account</Text>
              <View style={styles.accounts}>
                {accounts.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => { setAccount(a.id); setArmed(false); setArmedAdd(false); }}
                    style={[styles.acct, account === a.id && styles.acctOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: account === a.id }}
                    testID={`import-account-${a.id}`}
                  >
                    <Text style={[styles.acctText, account === a.id && styles.acctTextOn]}>
                      {a.name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>What is in the file</Text>
              <Text style={styles.stat} testID="import-count">
                {loaded.rows.length} transaction{loaded.rows.length === 1 ? '' : 's'},{' '}
                {loaded.rows[loaded.rows.length - 1]?.date} to {loaded.rows[0]?.date}
              </Text>
              {plan !== null && (
                <Text style={styles.stat} testID="import-plan">
                  {plan.adding.length} new
                  {plan.updating.length > 0 && `, ${plan.updating.length} changed`}
                  {plan.missing.length > 0 && `, ${plan.missing.length} no longer in the file`}
                  {plan.duplicates > 0 && `, ${plan.duplicates} already here`}
                </Text>
              )}
              {loaded.skipped.length > 0 && (
                <Text style={styles.note} testID="import-skipped">
                  {loaded.skipped.length} void or returned line
                  {loaded.skipped.length === 1 ? '' : 's'} left out — money that never moved
                </Text>
              )}
              {loaded.problems.length > 0 && (
                <Text style={styles.warn} testID="import-problems">
                  {loaded.problems.length} line{loaded.problems.length === 1 ? '' : 's'} could not
                  be read and will be skipped — first: line {loaded.problems[0]?.line},{' '}
                  {loaded.problems[0]?.reason}
                </Text>
              )}

              {/*
                WHAT THE FILE HAS CHANGED, and what it has lost — listed, not
                counted. A number on its own ("3 changed") is something to
                agree to blindly; three lines with the old amount beside the
                new one is something a person can actually check against the
                statement in front of them.
              */}
              {plan !== null && plan.updating.length > 0 && (
                <>
                  <Text style={styles.label}>What the file has changed</Text>
                  {plan.updating.slice(0, LISTED).map(({ txn, row }) => (
                    <View key={txn.id} style={styles.preview} testID={`import-changed-${txn.id}`}>
                      <Text style={styles.pvName} numberOfLines={1}>{txn.name}</Text>
                      <Text style={styles.pvChange} numberOfLines={1}>{changeText(txn, row)}</Text>
                    </View>
                  ))}
                  {plan.updating.length > LISTED && (
                    <Text style={styles.note}>…and {plan.updating.length - LISTED} more</Text>
                  )}
                </>
              )}

              {plan !== null && plan.missing.length > 0 && (
                <>
                  <Text style={styles.label}>No longer in the file</Text>
                  <Text style={styles.note}>
                    Inside the days this file covers, so the bank has dropped them — an
                    authorization that never landed. Importing removes them.
                  </Text>
                  {plan.missing.slice(0, LISTED).map((t) => (
                    <View key={t.id} style={styles.preview} testID={`import-missing-${t.id}`}>
                      <Text style={styles.pvDate}>{t.date}</Text>
                      <Text style={styles.pvName} numberOfLines={1}>{t.name}</Text>
                      <Text style={[styles.pvAmt, t.amount > 0 && styles.pvUp]}>
                        {formatAmount(t.amount)}
                      </Text>
                    </View>
                  ))}
                  {plan.missing.length > LISTED && (
                    <Text style={styles.note}>…and {plan.missing.length - LISTED} more</Text>
                  )}
                </>
              )}

              {/* The first few, so a person can see the parse is right before
                  agreeing to 1,952 of them. */}
              <Text style={styles.label}>The first few, as they would be filed</Text>
              {loaded.rows.slice(0, 8).map((r, i) => (
                <View key={`${r.date}-${i}`} style={styles.preview}>
                  <Text style={styles.pvDate}>{r.date}</Text>
                  <Text style={styles.pvName} numberOfLines={1}>{wellsFargoName(r.description)}</Text>
                  <Text style={[styles.pvAmt, r.amount > 0 && styles.pvUp]}>
                    {formatAmount(r.amount)}
                  </Text>
                </View>
              ))}

              {/*
                ONE press while it is only adding and updating, TWO once it
                would remove something — the same bargain the budget's delete
                and Replace below both make. Removing a row the bank has
                dropped is right far more often than not, and it is still a
                row disappearing without being asked for twice.

                The file's OWN rows go, not `plan.adding`: the plan is worked
                out again from them at the other end, and handing over the
                subset would leave that second plan looking at a file that had
                lost everything it already had — every row of which it would
                then report as no longer there.
              */}
              <Pressable
                onPress={() => {
                  if (account === null || plan === null || loaded === null) return;
                  if (plan.missing.length > 0 && !armedAdd) { setArmedAdd(true); return; }
                  onImport(account, loaded.rows, 'add');
                  onClose();
                }}
                style={[styles.btn, armedAdd ? styles.btnDanger : styles.btnGo]}
                accessibilityRole="button"
                accessibilityState={{ selected: armedAdd }}
                testID="import-add"
              >
                <Text style={styles.btnGoText}>
                  {plan === null ? 'Nothing to change'
                    : armedAdd ? `Press again: ${planText(plan)}`
                      : capital(planText(plan))}
                </Text>
              </Pressable>

              {/*
                Replace is the destructive one, so it is armed by a first
                press and says exactly how many rows it is about to tombstone.
                Same bargain as the budget's delete: no modal, but no single
                tap either.
              */}
              <Pressable
                onPress={() => {
                  if (account === null || replacing === null || loaded === null) return;
                  if (!armed) { setArmed(true); return; }
                  onImport(account, loaded.rows, 'replace');
                  onClose();
                }}
                style={[styles.btn, armed && styles.btnDanger]}
                accessibilityRole="button"
                accessibilityState={{ selected: armed }}
                testID="import-replace"
              >
                <Text style={[styles.btnText, armed && styles.btnGoText]}>
                  {armed
                    ? `Press again: delete ${replacing?.removing.length ?? 0} and import ${
                      replacing?.adding.length ?? 0}`
                    : 'Replace everything in this account'}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * A real `<input type="file">`, on the platforms that have one.
 *
 * react-native-web renders unknown elements through, but RN's types have no
 * idea what an input is — hence the cast, kept in one place rather than
 * sprinkled through the screen.
 */
function createFileInput(take: (name: string, text: string) => void): React.ReactNode {
  const Input = 'input' as unknown as React.ElementType;
  return (
    <Input
      type="file"
      accept=".csv,text/csv"
      data-testid="import-file"
      style={{ color: T.text, fontSize: 15 }}
      onChange={(e: { target: { files: { 0?: File } | null } }) => {
        const file = e.target.files?.[0];
        if (file === undefined) return;
        void file.text().then((text: string) => take(file.name, text));
      }}
    />
  );
}

/** How many of a list to show before saying "…and N more". */
const LISTED = 8;

/** What the file says has changed about one row, in as few words as it takes. */
function changeText(txn: { amount: number; date: string; cleared?: true }, row: CsvRow): string {
  const bits: string[] = [];
  if (txn.amount !== row.amount) bits.push(`${formatAmount(txn.amount)} → ${formatAmount(row.amount)}`);
  if (txn.date !== row.date) bits.push(`${txn.date} → ${row.date}`);
  if ((txn.cleared === true) !== row.cleared) bits.push(row.cleared ? 'now cleared' : 'back to pending');
  return bits.join(' · ');
}

/**
 * What the button is about to do, said as a sentence rather than a count.
 *
 * Three numbers on one button is a lot; leaving out the ones that are zero is
 * what keeps the usual case reading "Add 12 new transactions" exactly as it
 * did before any of this existed.
 */
function planText(plan: ImportPlan): string {
  const bits: string[] = [];
  if (plan.adding.length > 0) {
    bits.push(`add ${plan.adding.length} new transaction${plan.adding.length === 1 ? '' : 's'}`);
  }
  if (plan.updating.length > 0) bits.push(`update ${plan.updating.length}`);
  if (plan.missing.length > 0) bits.push(`remove ${plan.missing.length}`);
  if (bits.length === 0) return 'nothing to change';
  return bits.length === 1 ? bits[0] as string
    : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}

/** Sentence case, so the same words read as a label or as a second half. */
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  bar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  title: { color: T.text, fontSize: 17, fontWeight: '600', flex: 1, minHeight: TAP, lineHeight: TAP },
  barBtn: { height: TAP, justifyContent: 'center', paddingLeft: SPACE.md },
  barBtnText: { color: T.accent, fontSize: 16 },
  body: { padding: SPACE.lg, gap: SPACE.sm, paddingBottom: 48 },
  help: { color: T.dim, fontSize: 14, lineHeight: 20 },
  label: {
    color: T.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4,
    marginTop: SPACE.md,
  },
  pick: { paddingVertical: SPACE.sm },
  paste: {
    color: T.text, fontSize: 13, backgroundColor: T.card, borderRadius: 8, padding: SPACE.sm,
    minHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  accounts: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs },
  acct: {
    paddingHorizontal: SPACE.md, height: 34, justifyContent: 'center', borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  acctOn: { backgroundColor: T.accent, borderColor: T.accent },
  acctText: { color: T.text, fontSize: 14 },
  acctTextOn: { color: '#ffffff' },
  stat: { color: T.text, fontSize: 15 },
  warn: { color: T.gold, fontSize: 13, lineHeight: 18 },
  // Dim, not gold: a voided row left out is the import working, and a warning
  // colour would teach you to distrust a clean run.
  note: { color: T.dim, fontSize: 13, lineHeight: 18 },
  error: { color: T.danger, fontSize: 14 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: 2 },
  pvDate: { color: T.faint, fontSize: 12, width: 82, fontVariant: ['tabular-nums'] },
  pvName: { color: T.text, fontSize: 13, flex: 1, minWidth: 0 },
  pvAmt: { color: T.text, fontSize: 13, width: 84, textAlign: 'right', fontVariant: ['tabular-nums'] },
  pvUp: { color: T.positive },
  // GOLD, like `warn`: this is the file telling you something you did not
  // type moved, which is worth catching an eye on the way past.
  pvChange: {
    color: T.gold, fontSize: 12, textAlign: 'right', flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  btn: {
    minHeight: TAP, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge, marginTop: SPACE.sm,
    paddingHorizontal: SPACE.md,
  },
  btnText: { color: T.text, fontSize: 15, textAlign: 'center' },
  btnGo: { backgroundColor: T.accent, borderColor: T.accent },
  btnGoText: { color: '#ffffff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  btnDanger: { backgroundColor: T.danger, borderColor: T.danger },
});
