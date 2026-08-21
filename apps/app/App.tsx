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
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  addTxn, emptyStore, live, makeTxn, newId, type Draft, type Store,
} from '@acctmind/core';
import * as sync from './src/sync';
import { pushToWatch } from './src/watch';
import { AddTransaction } from './src/AddTransaction';
import { TransactionsScreen } from './src/TransactionsScreen';
import { load, save } from './src/persist';
import { SPACE, T, TAP } from './src/theme';

type Phase =
  | { k: 'loading' }
  | { k: 'ready'; store: Store; dropped: number }
  | { k: 'blocked'; error: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [adding, setAdding] = useState(false);
  /** A write that did not land. Shown, never swallowed. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The ledger outgrew iCloud's megabyte. Also shown, for the same reason. */
  const [tooBig, setTooBig] = useState(false);

  useEffect(() => {
    let running = true;
    load().then(async (r) => {
      if (!running) return;
      if (!r.ok) { setPhase({ k: 'blocked', error: r.error }); return; }

      // Show the device's own ledger FIRST, then reconcile. iCloud is
      // eventually consistent and may take a while to answer; waiting on it
      // before drawing would make a local-first app feel like a networked one.
      setPhase({ k: 'ready', store: r.store, dropped: r.dropped });

      // The wrist may never have heard from this phone. Push what we have
      // before reconciling, so a watch is current within a second of launch
      // rather than only after the next edit.
      void pushToWatch(r.store);

      const out = await sync.reconcile(r.store);
      if (!running) return;
      setTooBig(out.tooBig);
      if (out.changedLocally) {
        setPhase({ k: 'ready', store: out.store, dropped: r.dropped });
        // A merge result is only ours once it is on the disk. Saving here is
        // what stops the next launch starting from the pre-merge copy and
        // re-doing the whole reconciliation.
        save(out.store).catch((e: unknown) => setSaveError(String(e)));
        void pushToWatch(out.store);
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
        setPhase({ ...p, store: out.store });
        save(out.store).catch((e: unknown) => setSaveError(String(e)));
        void pushToWatch(out.store);
      });
      return p;
    });
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
  }, []);

  const onSave = useCallback((draft: Draft) => {
    if (phase.k !== 'ready') return;
    // The impure parts live here, at the edge — core takes the id and the
    // clock as arguments so a test can pin both.
    const next = addTxn(phase.store, makeTxn(draft, newId(), Date.now()));
    setAdding(false);
    commit(phase, next);
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
            <TransactionsScreen txns={live(phase.store.txns)} onAdd={() => setAdding(true)} />
            <AddTransaction
              visible={adding}
              onSave={onSave}
              onCancel={() => setAdding(false)}
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
