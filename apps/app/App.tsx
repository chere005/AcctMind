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
  addTxn, applyDraft, availableOf, budgetFor, duplicateTxn, emptyStore, ensureAccount,
  live, makeTxn, moveLineTo, moveTxnTo,
  applyImport, clearedTotal, ensureCategory, newId, nextColor, planImport, RECONCILE_NAME,
  reconcileAdjustment, total, putAccount, putBudget, putCategory, putLine, removeCategoryDeep,
  REORDER_GAP, assignMany, budgetCsv, undoTo, budgetIn, carriedInto, linesIn, monthOf,
  monthSet, today, tombstone, tombstoneMany, touch,
  txnText, updateTxn, setCleared,
  type AssignMode, type CsvRow, type Draft, type ImportMode, type Line, type Store, type Txn,
} from '@acctmind/core';
import * as Clipboard from 'expo-clipboard';
import { AppMenu } from './src/AppMenu';
import { Import } from './src/Import';
import { saveTextFile } from './src/savefile';
import * as peer from './src/peer';
import * as sync from './src/sync';
import { AddTransaction } from './src/AddTransaction';
import { Devices } from './src/Devices';
import { BudgetScreen, type Anchor, type LineField } from './src/BudgetScreen';
import { AmountPad } from './src/AmountPad';
import { DayPicker } from './src/DayPicker';
import { Manage } from './src/Manage';
import { CircleBtn } from './src/TopBar';
import { UndoIcon } from './src/Icons';
import { Tabs, type Tab } from './src/Tabs';
import { TransactionsScreen, type RowAction } from './src/TransactionsScreen';
import { load, save } from './src/persist';
import { DEFAULTS, loadPrefs, savePrefs, type Prefs } from './src/prefs';
import { SPACE, T, TAP } from './src/theme';

/** What the line editor's bar says: the category the line lives in. */
type Phase =
  | { k: 'loading' }
  | { k: 'ready'; store: Store; dropped: number }
  | { k: 'blocked'; error: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  /**
   * The ledger as it stood before the last change — Undo's one step.
   *
   * Sean, 2026-09-21: an "Undo last action" button beside the pencil. ONE
   * step, which is what he asked for: `commit` is the only path that
   * changes the store, so remembering the store it was handed is the whole
   * of the bookkeeping.
   *
   * It is dropped the moment a merge lands from iCloud or another device on
   * the wifi. Undoing across somebody else's change would take their edit
   * with it, silently, and this is the only place that knows the two
   * happened in that order.
   */
  const [undo, setUndo] = useState<Store | null>(null);
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
  /**
   * The category a + already knew, or null.
   *
   * Budget's per-category + is the only thing that sets it: pressing + beside
   * Groceries has already answered "which category", and asking again in the
   * form would be asking twice. Cleared with every other kind of add.
   */
  const [addingIn, setAddingIn] = useState<string | null>(null);
  /** Budget first, as asked. */
  const [tab, setTab] = useState<Tab>('budget');
  /** Which manager is open, if either. */
  const [managing, setManaging] = useState<'accounts' | 'categories' | null>(null);
  const [importing, setImporting] = useState(false);
  /**
   * The budget line being added or edited, if any.
   *
   * One piece of state for both, because they are the same form: `line: null`
   * is the add, and the category is carried either way because a line cannot
   * exist outside one.
   */
  /**
   * The amount being changed on the Budget page, if any.
   *
   * Separate from `lineEdit` because it is a different weight of thing: a
   * pad over the list rather than a screen instead of it. `budget` holds the
   * value as it is being typed, so the pad can show the result live and one
   * `Done` writes it.
   */
  /** The row whose DATE is being picked, if any. A date is chosen, not typed. */
  const [dating, setDating] = useState<Txn | null>(null);
  const [pad, setPad] = useState<
    {
      line: Line; spent: number; field: LineField;
      /**
       * Assigned to this line in earlier months — 0 outside Month.
       *
       * Carried so an `available` edit can take it off again: typing $200
       * into a line holding $150 from last month means assigning $50 now,
       * and a pad that forgot the $150 would quietly assign it twice.
       */
      carry: number;
      /** The value being typed, held as whichever number is STORED. */
      budget: number; needs: number; at: Anchor;
      /** Which budget set the change lands in — see core/views.ts. */
      set: string;
    } | null
  >(null);
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

  /** Remember a view choice, on this device only. */
  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      void savePrefs(next);
      return next;
    });
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
      const now = Date.now();
      // And ALWAYS at least one category, for the same reason: the Budget
      // tab's only way to make a line is the + beside a category, so a store
      // with none shows an empty state whose instruction is to go elsewhere.
      // Sean, 2026-09-15. Both are writes, so both happen only after a
      // successful read — a damaged store is never written to.
      const seeded = ensureCategory(
        ensureAccount(r.store, `acct-${newId()}`, now),
        `cat-${newId()}`,
        now,
      );
      if (seeded !== r.store) save(seeded).catch(() => {});
      r = { ...r, store: seeded };
      storeRef.current = r.store;

      // Show the device's own ledger FIRST, then reconcile. iCloud is
      // eventually consistent and may take a while to answer; waiting on it
      // before drawing would make a local-first app feel like a networked one.
      setPhase({ k: 'ready', store: r.store, dropped: r.dropped });

      // Any peer that connected WHILE this was loading. Its opening
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
        // Their change landed on top of ours; ours is no longer the last
        // thing that happened here. See `undo`.
        setUndo(null);
        setPhase({ ...p, store: out.store });
        save(out.store).catch((e: unknown) => setSaveError(String(e)));
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
      setUndo(null);
      setPhase((p) => (p.k === 'ready' ? { ...p, store } : p));
      save(store).catch((e: unknown) => setSaveError(String(e)));
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
  const commit = useCallback((
    current: Extract<Phase, { k: 'ready' }>,
    next: Store,
    /**
     * Is this a change Undo should offer to take back?
     *
     * False for the undo ITSELF, which is what makes the button one-shot
     * rather than a toggle: pressing it again would otherwise redo the
     * thing you just undid, from a control whose label says Undo.
     */
    undoable = true,
  ) => {
    // Before setPhase, and before any await: see storeRef's note.
    storeRef.current = next;
    setUndo(undoable ? current.store : null);
    setPhase({ ...current, store: next });
    save(next)
      .then(() => setSaveError(null))
      .catch((e: unknown) => setSaveError(String(e)));
    // Publishing is separate from saving, and failing at it is not failing to
    // save: the transaction is safely on this device either way. Only the
    // sharing of it is in doubt, so it gets its own, quieter banner.
    void sync.publish(next).then((ok) => setTooBig(!ok && sync.available()));
    // And the wrist, which is a separate link on a separate transport: the
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
  /**
   * A short-lived line at the top of the app — Export's only way of saying
   * it worked.
   *
   * This app has no toast host (CalMind's is a whole component and a whole
   * canon file). What it has is the banner the dropped-rows and save-error
   * messages already use, so a note is that banner with a timer on it
   * rather than a second way of telling somebody something.
   */
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const say = useCallback((text: string) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  /**
   * THE BUDGET AS A FILE — Sean, 2026-09-21: "export budget".
   *
   * What it exports is the budget as the tab is CURRENTLY READING IT — the
   * month the stepper is on. It asked a View picker which set to use until
   * 2026-09-21; there is one set now (Sean: "always have a month selected"),
   * so the file and the screen cannot disagree about which budget they mean.
   *
   * The shape of the file is core's (`budgetCsv`); the numbers are the same
   * ones the rows draw, read through the same `budgetIn`/`carriedInto`.
   */
  const onExportBudget = useCallback(() => {
    if (phase.k !== 'ready') return;
    const store = phase.store;
    const set = monthSet(prefs.budgetMonth);
    const txns = live(store.txns);
    const lines = live(store.lines);
    const inScope = txns.filter((t) => monthOf(t.date) === prefs.budgetMonth);
    // The same map the screen draws from, so the file and the rows cannot
    // disagree about what a line is worth — see core's carriedInto.
    const carried = carriedInto(store, prefs.budgetMonth, lines, txns);
    const rows = live(store.categories).flatMap((c) =>
      linesIn(lines, c.id).map((l) => {
        const assigned = budgetIn(store, set, l);
        const spent = total(inScope.filter((t) => t.category === l.id));
        return {
          category: c.name, line: l.name, assigned, spent,
          available: availableOf(assigned, spent, carried.get(l.id) ?? 0),
        };
      }));
    const name = `acctmind-budget-${prefs.budgetMonth}.csv`;
    void saveTextFile(name, budgetCsv(rows)).then(say).catch(() => say('Could not export'));
  }, [phase, prefs.budgetMonth, say]);

  /**
   * UNDO, built here and handed to both tabs.
   *
   * One control rather than one per screen, for the reason the cog is one:
   * it is about the LEDGER, not about the screen you happen to be on, and
   * two copies of it is two places for "is there anything to undo" to
   * disagree. Left of the pencil, which is where Sean asked for it.
   *
   * Drawn always and DISABLED when there is nothing to take back — the
   * app's standing answer (see the pick bar's Delete): a live control that
   * does nothing is the one that gets pressed twice.
   */
  const undoBtn = (
    <CircleBtn
      onPress={() => {
        if (phase.k !== 'ready' || undo === null) return;
        // `undoTo`, not the snapshot itself. Core's note says why: a record
        // put back with its old clock loses the next merge to the very edit
        // being undone, so an undone delete deletes itself again.
        commit(phase, undoTo(phase.store, undo, Date.now()), false);
      }}
      off={undo === null || phase.k !== 'ready'}
      label="Undo last action"
      testID="undo-button"
    >
      <UndoIcon color={undo === null ? T.faint : T.text} />
    </CircleBtn>
  );

  const appMenu = (
    <AppMenu
      onImport={() => setImporting(true)}
      onExport={onExportBudget}
      whole={prefs.amountMode === 'whole'}
      onWhole={(next) => setPref('amountMode', next ? 'whole' : 'cents')}
    />
  );

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
      <SafeAreaView style={styles.fill} edges={['top', 'bottom', 'left', 'right']}>
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
            {/* Export's receipt — the file was handed over or copied, and on
                both paths the only evidence is that something left the app. */}
            {note !== null && <Banner testID="note" tone="warn" text={note} />}
            {tooBig && (
              <Banner
                testID="toobig-banner"
                tone="warn"
                text="Saved on this device, but too large for iCloud — your other devices will not see it."
              />
            )}
            {tab === 'budget' && (
              <BudgetScreen
                txns={live(phase.store.txns)}
                categories={live(phase.store.categories)}
                lines={live(phase.store.lines)}
                budgets={phase.store.budgets}
                budgetMonth={prefs.budgetMonth}
                onBudgetMonth={(m: string) => setPref('budgetMonth', m)}
                menu={appMenu}
                undo={undoBtn}
                collapsed={prefs.collapsed}
                onCollapsed={(ids) => setPref('collapsed', [...ids])}
                onManage={() => setManaging('categories')}
                /*
                 * The + adds a LINE, not a transaction — Sean, 2026-08-21 —
                 * and since 2026-09-15 it adds one OUTRIGHT rather than
                 * opening an editor to ask what it should be called. The row
                 * appears named `New line` with nothing budgeted, and edit
                 * mode renames it in place. One tap to have the thing, one
                 * tap to name it, and no modal between them.
                 */
                onAddLine={(category) => {
                  if (phase.k !== 'ready') return;
                  const now = Date.now();
                  const siblings = live(phase.store.lines).filter((l) => l.category === category);
                  commit(phase, putLine(phase.store, {
                    id: `line-${newId()}`,
                    name: 'New line',
                    category,
                    budget: 0,
                    needs: 0,
                    snoozed: false,
                    order: siblings.reduce((n, l) => Math.max(n, l.order), 0) + REORDER_GAP,
                    created: now,
                    updated: now,
                  }));
                }}
                onEditAmount={({ line, spent, budgeted, carry, set }, field, at) =>
                  // `budgeted`, not `line.budget`: the pad opens showing what
                  // the ACTIVE SET holds, which is what is on screen.
                  setPad({ line, spent, carry, field, budget: budgeted, needs: line.needs, at, set })}
                onRenameLine={(line, name) => {
                  if (phase.k !== 'ready') return;
                  commit(phase, putLine(phase.store, touch({ ...line, name }, Date.now())));
                }}
                onRenameCategory={(category, name) => {
                  if (phase.k !== 'ready') return;
                  commit(phase, putCategory(
                    phase.store, touch({ ...category, name }, Date.now()),
                  ));
                }}
                onSnoozeLine={(line, next) => {
                  if (phase.k !== 'ready') return;
                  commit(phase, putLine(
                    phase.store, touch({ ...line, snoozed: next }, Date.now()),
                  ));
                }}
                onDeleteLine={(line) => {
                  if (phase.k !== 'ready') return;
                  commit(phase, putLine(phase.store, tombstone(line, Date.now())));
                }}
                /*
                 * Three records deep, in core — the category, its lines, and
                 * the transactions filed against those lines, which go back
                 * to no category rather than pointing at something deleted.
                 */
                onDeleteCategory={(category) => {
                  if (phase.k !== 'ready') return;
                  commit(phase, removeCategoryDeep(phase.store, category.id, Date.now()));
                }}
                /* A line dropped into a category — its own or another one
                   (Sean, 2026-09-21). Core decides both halves: which slot
                   the order lands in, and that the line keeps every amount
                   it carries. One record changes, or none. */
                onMoveLine={(line, category, beforeId) => {
                  if (phase.k !== 'ready') return;
                  const moved = moveLineTo(live(phase.store.lines), line, category, beforeId, Date.now());
                  if (moved !== null) commit(phase, putLine(phase.store, moved));
                }}
                /*
                 * The bar's three buttons, and the whole of what happens
                 * here is deciding WHICH SET and handing it over. Core owns
                 * both halves: `assignedFor` says what each mode makes of a
                 * line, `assignMany` says where the answer lands.
                 *
                 * Null means nothing to write — every picked line already
                 * held the amount asked for — and a commit of a store
                 * identical to the one we have still saves it, publishes it
                 * to every peer and pushes it to the wrist.
                 */
                onAssignMany={(picks, mode: AssignMode) => {
                  if (phase.k !== 'ready') return;
                  const out = assignMany(
                    phase.store, monthSet(prefs.budgetMonth), picks, mode, Date.now(),
                  );
                  if (out !== null) commit(phase, { ...phase.store, ...out });
                }}
              />
            )}

            {/* Tombstones travel; they are not shown. */}
            {tab === 'transactions' && (
            <TransactionsScreen
              txns={live(phase.store.txns)}
              onAdd={(account) => {
                setEditing(null);
                setAddingTo(account);
                setAddingIn(null);
                setAdding(true);
              }}
              onAction={onRowAction}
              /* A row dropped into an account — its own or another one
                 (Sean, 2026-09-21). Core returns only the row that changed,
                 or null when nothing needs to move, so a drag that ends
                 where it started costs no merge clock and no sync. */
              onMove={(txn, account, beforeId) => {
                if (phase.k !== 'ready') return;
                const moved = moveTxnTo(live(phase.store.txns), txn, account, beforeId, Date.now());
                if (moved !== null) commit(phase, updateTxn(phase.store, moved));
              }}
              /* One field, changed in place. `touch` so it travels; the rest
                 of the record is untouched, which is what makes this cheap
                 enough to do on a tap. */
              onInline={(txn, patch) => {
                if (phase.k !== 'ready') return;
                const next = { ...txn, ...patch };
                if (patch.name !== undefined && patch.name.trim() === '') return;
                commit(phase, updateTxn(phase.store, touch(next, Date.now())));
              }}
              /* The pick bar's Delete. One press, one clock, one commit —
                 core's `tombstoneMany` does the whole batch in a single pass
                 so no reader can see a half-finished delete. */
              onDeleteMany={(ids) => {
                if (phase.k !== 'ready') return;
                commit(phase, tombstoneMany(phase.store, ids, Date.now()));
              }}
              onDate={(txn) => setDating(txn)}
              /* The cleared box: core says what the row becomes, `touch` included,
                 so the tick travels to the other devices like any edit. */
              onCleared={(txn, cleared) => {
                if (phase.k !== 'ready') return;
                commit(phase, updateTxn(phase.store, setCleared(txn, cleared, Date.now())));
              }}
              onDevices={peer.supported() ? () => setShowDevices(true) : undefined}
              peers={peers}
              menu={appMenu}
              undo={undoBtn}
              accounts={live(phase.store.accounts)}
              sort={prefs.sort}
              onSort={(m) => setPref('sort', m)}
              collapsed={prefs.collapsed}
              onCollapsed={(ids) => setPref('collapsed', [...ids])}
              onManage={() => setManaging('accounts')}
              lines={live(phase.store.lines)}
              /*
               * Reconcile: say what the account actually holds, and the
               * difference becomes one transaction dated TODAY — Sean,
               * 2026-09-15. The arithmetic and the name are core's; the only
               * thing decided here is that a zero difference writes nothing,
               * which is `reconcileAdjustment` returning 0 and this doing
               * nothing with it.
               */
              onReconcile={(account, stated, what) => {
                if (phase.k !== 'ready') return;
                const mine = live(phase.store.txns).filter((t) => t.account === account);
                // Against the figure that was STATED: the whole balance, or
                // only what has cleared (Sean, 2026-09-18) — the statement in
                // your hand is a statement about the second.
                const held = what === 'cleared' ? clearedTotal(mine) : total(mine);
                const diff = reconcileAdjustment(held, stated);
                if (diff === 0) return;
                const now = Date.now();
                commit(phase, addTxn(phase.store, {
                  id: `txn-${newId()}`,
                  name: RECONCILE_NAME,
                  description: '',
                  amount: diff,
                  date: today(),
                  account,
                  category: null,
                  order: 0,
                  created: now,
                  updated: now,
                  // A difference the bank has already settled is on the
                  // statement by definition, so the row that closes it is
                  // cleared — otherwise the cleared figure would still
                  // disagree with the statement it was just told to match.
                  ...(what === 'cleared' ? { cleared: true as const } : {}),
                }));
              }}
            />
            )}

            {/*
              The CSV import. Sean, 2026-09-15.
              
              `applyImport` takes the PLAN rather than the rows, so what gets
              written is the same object the screen showed a count for — there
              is no second chance for the two to disagree about how many rows
              are about to move.
            */}
            <Import
              visible={importing}
              store={phase.store}
              accounts={live(phase.store.accounts)}
              onClose={() => setImporting(false)}
              onImport={(account: string, rows: readonly CsvRow[], mode: ImportMode) => {
                if (phase.k !== 'ready') return;
                const now = Date.now();
                commit(phase, applyImport(
                  phase.store,
                  account,
                  planImport(phase.store, account, rows, mode),
                  now,
                  () => `txn-${newId()}`,
                ));
              }}
            />
            <Manage
              visible={managing !== null}
              label={managing === 'categories' ? 'Categories' : 'Accounts'}
              rows={managing === 'categories'
                ? live(phase.store.categories).map((c) => ({
                    id: c.id, name: c.name, color: c.color,
                  }))
                : live(phase.store.accounts).map((a) => ({
                    id: a.id, name: a.name, color: a.color,
                  }))}
              onClose={() => setManaging(null)}
              onAdd={() => {
                const now = Date.now();
                if (managing === 'categories') {
                  const cats = live(phase.store.categories);
                  commit(phase, putCategory(phase.store, {
                    id: `cat-${newId()}`,
                    name: '',
                    // Cycle the palette rather than always opening blue, so a
                    // list of new ones is telling apart at a glance.
                    color: nextColor(cats.map((c) => c.color)),
                    order: cats.length,
                    created: now,
                    updated: now,
                  }));
                } else {
                  const accts = live(phase.store.accounts);
                  commit(phase, putAccount(phase.store, {
                    id: `acct-${newId()}`,
                    name: '',
                    color: nextColor(accts.map((a) => a.color)),
                    order: accts.length,
                    created: now,
                    updated: now,
                  }));
                }
              }}
              onChange={(row) => {
                const now = Date.now();
                if (managing === 'categories') {
                  const c = phase.store.categories.find((x) => x.id === row.id);
                  if (c === undefined) return;
                  commit(phase, putCategory(phase.store, touch({
                    ...c, name: row.name, color: row.color,
                  }, now)));
                } else {
                  const a = phase.store.accounts.find((x) => x.id === row.id);
                  if (a === undefined) return;
                  commit(phase, putAccount(phase.store, touch({
                    ...a, name: row.name, color: row.color,
                  }, now)));
                }
              }}
              onDelete={(row) => {
                const now = Date.now();
                if (managing === 'categories') {
                  const c = phase.store.categories.find((x) => x.id === row.id);
                  if (c === undefined) return;
                  commit(phase, putCategory(phase.store, tombstone(c, now)));
                } else {
                  // The LAST account cannot go: every transaction has to live
                  // somewhere, and removing the only home would strand them.
                  if (live(phase.store.accounts).length <= 1) return;
                  const a = phase.store.accounts.find((x) => x.id === row.id);
                  if (a === undefined) return;
                  commit(phase, putAccount(phase.store, tombstone(a, now)));
                }
              }}
            />
            {/*
              The pad, over the Budget page. `available` edits do not store a
              third number — they say what `budget` has to be, given what has
              moved. See core/budget.ts.
            */}
            {/* The day grid, for a date tapped in the list. */}
            <DayPicker
              visible={dating !== null}
              value={dating?.date ?? today()}
              onPick={(day) => {
                if (phase.k === 'ready' && dating !== null && day !== dating.date) {
                  commit(phase, updateTxn(phase.store, touch({ ...dating, date: day }, Date.now())));
                }
                setDating(null);
              }}
              onCancel={() => setDating(null)}
            />
            <AmountPad
              visible={pad !== null}
              anchor={pad?.at ?? null}
              value={pad === null
                ? 0
                : pad.field === 'needs' ? pad.needs
                : pad.field === 'available' ? availableOf(pad.budget, pad.spent, pad.carry)
                : pad.budget}
              onValue={(next) => setPad((p) => (p === null ? p : (
                p.field === 'needs'
                  ? { ...p, needs: next }
                  : {
                      ...p,
                      budget: p.field === 'available' ? budgetFor(next, p.spent, p.carry) : next,
                    }
              )))}
              onDone={() => {
                if (phase.k !== 'ready' || pad === null) return;
                // TWO PLACES, because they are two different kinds of
                // number — see core/budget.ts.
                //
                // The BUDGET goes in the set's own record and leaves the
                // line alone, which is the whole promise of "budget changes
                // are unique to that view only". `needs` is NOT per set — a
                // target is what the line is FOR, and it does not change
                // because you are looking at October — so it is written on
                // the line.
                //
                // There was an All Time branch here, writing the budget onto
                // the line, until 2026-09-21. `pad.set` comes from the Budget
                // screen and the screen is always on a month now, so the
                // branch was one nobody could take. The set still exists in
                // core (`budgetIn` reads it) and holds what earlier versions
                // wrote there; nothing reaches it from here.
                const now = Date.now();
                commit(phase, {
                  ...putLine(phase.store, touch({ ...pad.line, needs: pad.needs }, now)),
                  budgets: putBudget(phase.store, pad.set, pad.line.id, pad.budget, now),
                });
                setPad(null);
              }}
            />
            {/* LAST in the tree, so it is last on the screen. Restyling it
                to look like a bottom bar while it stayed first in the JSX is
                exactly what shipped: it looked wrong and read as the change
                never arriving. */}
            <Tabs
              tab={tab}
              onTab={setTab}
              onAdd={() => {
                if (phase.k !== 'ready') return;
                // The + is in the bar on both tabs, so it has to answer for
                // Budget too: a transaction is a transaction, and landing on
                // a filled form behind the wrong screen would be a puzzle.
                setTab('transactions');
                setEditing(null);
                setAddingTo(live(phase.store.accounts)[0]?.id ?? '');
                setAddingIn(null);
                setAdding(true);
              }}
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
              category={addingIn}
              categories={live(phase.store.categories)}
              lines={live(phase.store.lines)}
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
