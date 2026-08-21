/**
 * AcctMind.
 *
 * This file owns the one thing the screens must not get wrong: the store's
 * lifecycle. Everything else is delegated — the rules to `@acctmind/core`,
 * the drawing to `src/`.
 *
 * The load has three outcomes, not two, and the third is why this is written
 * as a state machine rather than a `useState<Store>`:
 *
 *   loading  — nothing on screen yet
 *   ready    — a store, possibly with some rows dropped as unreadable
 *   blocked  — the saved data is DAMAGED
 *
 * In `blocked` the app renders an explanation and **never writes**. There is
 * no server copy of this ledger; a damaged read that fell back to an empty
 * store would show "no transactions", and the next save would make that
 * true. So the add button is gone in that state, by construction rather than
 * by remembering to check.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  addTxn, applyDraft, duplicateTxn, emptyStore, ensureAccount, live, makeTxn, newId,
  tombstone, txnText, updateTxn, type Draft, type Store, type Txn,
} from '@acctmind/core';
import * as Clipboard from 'expo-clipboard';
import * as peer from './src/peer';
import * as sync from './src/sync';
import { pushToWatch } from './src/watch';
import { AddTransaction } from './src/AddTransaction';
import { Devices } from './src/Devices';
import { TransactionsScreen, type RowAction } from './src/TransactionsScreen';
import { load, save } from './src/persist';
import { DEFAULTS, loadPrefs, savePrefs, type Prefs } from './src/prefs';
import { SPACE, T, TAP } from './src/theme';

type Phase =
  | { k: 'loading' }
  | { k: 'ready'; store: Store; dropped: number }
  | { k: 'blocked'; error: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [adding, setAdding] = useState(false);
  /** The row the form is editing, or null when it is adding a new one. */
  const [editing, setEditing] = useState<Txn | null>(null);
  /**
   * The account a new transaction goes into.
   *
   * Set by whichever + was pressed — the header's, or an account section's.
   * Held here rather than derived, because the form must not have to guess
   * which section it was opened from.
   */
  const [addingTo, setAddingTo] = useState('');
  /** A write that did not land. Shown, never swallowed. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The ledger outgrew iCloud's megabyte. Also shown, for the same reason. */
  const [tooBig, setTooBig] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  /** Devices connected over the local network right now. */
  const [peers, setPeers] = useState(0);
  /**
   * Settings, which are this device's and are NOT part of the ledger.
   *
   * They start at the defaults and are replaced when the saved ones arrive.
   * That order matters: the app draws immediately rather than waiting on a
   * read, and the only visible cost of a slow disk is the `.00` button
   * showing off for a frame before it shows on.
   */
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    let running = true;
    void loadPrefs().then((p) => { if (running) setPrefs(p); });
    return () => { running = false; };
  }, []);

  /** Remember the choice, on this device only. */
  const setAmountMode = useCallback((amountMode: Prefs['amountMode']) => {
    const next = { amountMode };
    setPrefs(next);
    void savePrefs(next);
  }, []);

  /**
   * The ledger, for code that reads it from OUTSIDE a render.
   *
   * A peer's frame arrives on a native callback, not from a user gesture, and
   * it must be merged into whatever this device holds at that instant. A
   * closure over `phase` would hold whatever it held when the listener was
   * installed, and the failure that causes is not a stale screen — it is
   * data loss. Add a transaction, have a frame land in the milliseconds
   * before React re-renders, and the merge runs against the ledger WITHOUT
   * that transaction, produces a result without it, and saves that over the
   * good copy.
   *
   * So every place that produces a new store writes it here FIRST,
   * synchronously, before anything asynchronous can read it. There are four
   * such places and they are all in this file.
   */
  const storeRef = useRef<Store | null>(null);

  useEffect(() => {
    let running = true;
    load().then(async (loaded) => {
      let r = loaded;
      if (!running) return;
      if (!r.ok) {
        // Blocked means nothing may be merged in: a peer must not be allowed
        // to launder damage into a store this device could not read.
        storeRef.current = null;
        setPhase({ k: 'blocked', error: r.error });
        return;
      }
      /*
       * There is ALWAYS at least one account. A store that has none — a fresh
       * install, or one migrated from before accounts existed — gets one here
       * before anything is drawn, because a screen with no section has no +
       * that leads anywhere.
       *
       * This is a WRITE, so it happens only after a successful read. On a
       * blocked store nothing is written at all, which is the whole reason
       * that branch returns above.
       */
      const withAccount = ensureAccount(r.store, `acct-${newId()}`, Date.now());
      if (withAccount !== r.store) save(withAccount).catch(() => {});
      r = { ...r, store: withAccount };
      storeRef.current = r.store;

      // Show the device's own ledger FIRST, then reconcile. iCloud is
      // eventually consistent and may take a while to answer; waiting on it
      // before drawing would make a local-first app feel like a networked one.
      setPhase({ k: 'ready', store: r.store, dropped: r.dropped });

      // The wrist may never have heard from this phone. Push what we have
      // before reconciling, so a watch is current within a second of launch
      // rather than only after the next edit.
      void pushToWatch(r.store);

      // And any peer that connected WHILE this was loading. Its opening
      // frame arrived with `current()` still null and was dropped — rightly,
      // since there was nothing to merge into yet — and nothing would have
      // asked again until the connection was rebuilt. Publishing here is what
      // restarts that exchange; the per-peer memo in src/peer.ts keeps it
      // from duplicating a frame already sent.
      peer.publish(r.store);

      const out = await sync.reconcile(r.store);
      if (!running) return;
      setTooBig(out.tooBig);
      if (out.changedLocally) {
        storeRef.current = out.store;
        setPhase({ k: 'ready', store: out.store, dropped: r.dropped });
        // A merge result is only ours once it is on the disk. Saving here is
        // what stops the next launch starting from the pre-merge copy and
        // re-doing the whole reconciliation.
        save(out.store).catch((e: unknown) => setSaveError(String(e)));
        void pushToWatch(out.store);
        peer.publish(out.store);
      }
    });
    return () => { running = false; };
  }, []);

  // Another device wrote. The notification carries the new value, so no
  // second round trip — and no window in which a fresh pull could return
  // something older than what woke us.
  useEffect(() => sync.onRemoteChange((remote) => {
    setPhase((p) => {
      // Never reconcile on top of a store we could not read. The local copy
      // is the thing in doubt; merging into it would launder the damage.
      if (p.k !== 'ready') return p;
      void sync.reconcile(p.store, remote).then((out) => {
        setTooBig(out.tooBig);
        if (!out.changedLocally) return;
        storeRef.current = out.store;
        setPhase({ ...p, store: out.store });
        save(out.store).catch((e: unknown) => setSaveError(String(e)));
        void pushToWatch(out.store);
      });
      return p;
    });
  }), []);

  /**
   * The local-network link.
   *
   * Mounted once. `current` READS the ref rather than closing over state, so
   * a frame is always merged into the ledger as it stands at that instant —
   * see the note on storeRef for the data loss the alternative causes.
   */
  useEffect(() => peer.attach({
    current: () => storeRef.current,
    merged: (store) => {
      storeRef.current = store;
      setPhase((p) => (p.k === 'ready' ? { ...p, store } : p));
      save(store).catch((e: unknown) => setSaveError(String(e)));
      void pushToWatch(store);
    },
    status: setPeers,
  }), []);

  /**
   * Show it, then write it.
   *
   * Optimistic on screen, honest about the disk: the list updates now, and a
   * failed write raises the banner rather than a `.catch(() => {})` letting
   * someone believe it saved.
   *
   * Note what this does NOT do — call `save()` from inside a `setPhase`
   * updater. An updater must be pure. Calling one that itself sets state
   * makes React treat it as a render-phase update and RESTART the render,
   * which silently discards the other updates batched with it. That cost a
   * real bug here on the first run: the transaction saved correctly and the
   * add form stayed open, because the `setAdding(false)` queued alongside it
   * was thrown away. `e2e/add.spec.ts` holds the door shut on it.
   */
  const commit = useCallback((current: Extract<Phase, { k: 'ready' }>, next: Store) => {
    // Before setPhase, and before any await: see storeRef's note.
    storeRef.current = next;
    setPhase({ ...current, store: next });
    save(next)
      .then(() => setSaveError(null))
      .catch((e: unknown) => setSaveError(String(e)));
    // Publishing is separate from saving, and failing at it is not failing to
    // save: the transaction is safely on this device either way. Only the
    // sharing of it is in doubt, so it gets its own, quieter banner.
    void sync.publish(next).then((ok) => setTooBig(!ok && sync.available()));
    // And the wrist, which is a separate link on a separate transport: the
    // watch keeps working when iCloud is unavailable, and vice versa.
    void pushToWatch(next);
    // And any device on this wifi. Three transports, none of which is
    // allowed to break when another is unavailable.
    peer.publish(next);
  }, []);

  const onSave = useCallback((draft: Draft) => {
    if (phase.k !== 'ready') return;
    // The impure parts live here, at the edge — core takes the id and the
    // clock as arguments so a test can pin both.
    const next = editing === null
      ? addTxn(phase.store, makeTxn(draft, newId(), Date.now()))
      : updateTxn(phase.store, applyDraft(editing, draft, Date.now()));
    setAdding(false);
    setEditing(null);
    commit(phase, next);
  }, [phase, commit, editing]);

  /**
   * What a held-down row offers.
   *
   * Three of the four change the ledger and go through `commit`, which is the
   * only path that saves, publishes to peers and pushes to the wrist — so a
   * duplicate or a delete syncs exactly like an add, without this file
   * remembering to do three things each time.
   *
   * A delete is a TOMBSTONE, not a removal. Dropping the record would work
   * perfectly on this device and then be undone by the next merge, because
   * every other device still has it and nothing would say it had gone.
   */
  const onRowAction = useCallback((action: RowAction, txn: Txn) => {
    if (phase.k !== 'ready') return;
    switch (action) {
      case 'edit':
        setEditing(txn);
        setAdding(true);
        return;
      case 'duplicate':
        commit(phase, addTxn(phase.store, duplicateTxn(txn, newId(), Date.now())));
        return;
      case 'copy':
        // The clipboard is the one action that changes nothing, so it neither
        // saves nor syncs. A failure is swallowed deliberately: there is
        // nothing at stake and nothing to recover.
        void Clipboard.setStringAsync(txnText(txn)).catch(() => {});
        return;
      case 'delete':
        commit(phase, updateTxn(phase.store, tombstone(txn, Date.now())));
        return;
    }
  }, [phase, commit]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        {phase.k === 'loading' && (
          <View style={styles.centre} testID="loading">
            <ActivityIndicator color={T.dim} />
          </View>
        )}

        {phase.k === 'blocked' && <Blocked error={phase.error} />}

        {phase.k === 'ready' && (
          <>
            {phase.dropped > 0 && (
              <Banner
                testID="dropped-banner"
                tone="warn"
                text={`${phase.dropped} saved ${phase.dropped === 1 ? 'row' : 'rows'} could not be read and ${phase.dropped === 1 ? 'was' : 'were'} skipped.`}
              />
            )}
            {saveError !== null && (
              <Banner testID="save-error" tone="bad" text={`Not saved — ${saveError}`} />
            )}
            {tooBig && (
              <Banner
                testID="toobig-banner"
                tone="warn"
                text="Saved on this device, but too large for iCloud — your other devices will not see it."
              />
            )}
            {/* Tombstones travel; they are not shown. */}
            <TransactionsScreen
              txns={live(phase.store.txns)}
              onAdd={(account) => {
                setEditing(null);
                setAddingTo(account);
                setAdding(true);
              }}
              onAction={onRowAction}
              onDevices={peer.supported() ? () => setShowDevices(true) : undefined}
              peers={peers}
              amountMode={prefs.amountMode}
              onAmountMode={setAmountMode}
              accounts={live(phase.store.accounts)}
            />
            <Devices
              visible={showDevices}
              peers={peers}
              onClose={() => setShowDevices(false)}
            />
            <AddTransaction
              visible={adding}
              editing={editing ?? undefined}
              mode={prefs.amountMode}
              account={addingTo}
              onSave={onSave}
              onCancel={() => { setAdding(false); setEditing(null); }}
            />
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/**
 * The damaged-store screen.
 *
 * It offers exactly one action, and that action is destructive, so it says
 * so in the words rather than in a colour. Anything gentler — a "retry", a
 * silent fallback — either does nothing or does this without asking.
 */
function Blocked({ error }: { error: string }) {
  const [sure, setSure] = useState(false);
  return (
    <View style={[styles.centre, styles.pad]} testID="blocked">
      <Text style={styles.blockedTitle}>This device&apos;s saved data could not be read</Text>
      <Text style={styles.blockedBody}>{error}</Text>
      <Text style={styles.blockedBody}>
        Nothing has been written over. If you have this ledger on another
        device, use that one — starting fresh here will discard whatever is
        stored on this device.
      </Text>
      {!sure ? (
        <Pressable style={styles.blockedBtn} onPress={() => setSure(true)} testID="start-fresh">
          <Text style={styles.blockedBtnText}>Start fresh…</Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.blockedBtn, styles.blockedBtnBad]}
          onPress={() => { void save(emptyStore()); }}
          testID="start-fresh-confirm"
        >
          <Text style={styles.blockedBtnText}>Discard it and start fresh</Text>
        </Pressable>
      )}
    </View>
  );
}

function Banner({ text, tone, testID }: { text: string; tone: 'warn' | 'bad'; testID: string }) {
  return (
    <View style={[styles.banner, tone === 'bad' && styles.bannerBad]} testID={testID}>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.md },
  pad: { padding: SPACE.xl },
  blockedTitle: { color: T.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  blockedBody: { color: T.dim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  blockedBtn: {
    minHeight: TAP, justifyContent: 'center', paddingHorizontal: SPACE.xl,
    borderRadius: 10, backgroundColor: T.card, marginTop: SPACE.sm,
  },
  blockedBtnBad: { backgroundColor: T.danger },
  blockedBtnText: { color: T.text, fontSize: 16, fontWeight: '600' },
  banner: { backgroundColor: T.card, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm },
  bannerBad: { backgroundColor: T.danger },
  bannerText: { color: T.text, fontSize: 13 },
});
