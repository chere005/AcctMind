/**
 * The one screen: a header that says Transactions, the running total, the
 * list, and the + that opens the form.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View, type PanResponderInstance,
} from 'react-native';
import {
  LONG_PRESS_MS, amountDigits, amountInput, claimsSwipe, clearedTotal, dropTarget, foldLevel,
  formatAmount, formatDay, parseAmount, pickTap, rowTap,
  selectedTotal, slotEntries,
  signedCents, sortTxns, swipeArms, toggleSelected, total,
  type Account, type Line, type SortMode, type Txn,
} from '@acctmind/core';
import { Dot } from './Dot';
import { SectionPick } from './SectionPick';
import { SortPick } from './SortPick';
import {
  ClipboardIcon, DuplicateIcon, HammerIcon, PencilIcon, XIcon,
} from './Icons';
import { PickBar } from './PickBar';
import { useRowDrag, type RowDrag } from './rowdrag';
import { TipBubble, useTip } from './Tip';
import { BarRow, CircleBtn, TopBar } from './TopBar';
import { SPACE, T, TAP } from './theme';

export type RowAction = 'edit' | 'duplicate' | 'copy' | 'delete';

type Props = {
  txns: readonly Txn[];
  /** Add a transaction to this account. */
  onAdd: (account: string) => void;
  /** A row was held down and an action chosen. */
  onAction?: ((action: RowAction, txn: Txn) => void) | undefined;
  /**
   * A row was dropped somewhere: the account it joins, and the row it lands
   * ABOVE (`null` for the end of that account).
   *
   * It took `(txn, shown, index)` until 2026-09-21 — an index into ONE
   * account's own list, which is the shape of a drag that could never leave
   * it. Sean: "make it possible to drag items between sections and folders…
   * anywhere that has folders and sections and dragging items." An account
   * is this screen's section, and a destination plus a neighbour is the pair
   * that says both halves.
   */
  onMove?: ((txn: Txn, account: string, beforeId: string | null) => void) | undefined;
  /** One field of one row was edited in place. */
  onInline?: ((txn: Txn, patch: { name?: string; amount?: number }) => void) | undefined;
  /** The date on a row was tapped — the caller opens the day grid. */
  onDate?: ((txn: Txn) => void) | undefined;
  /** The cleared box on a row was flipped. Absent where the ledger is read-only. */
  onCleared?: ((txn: Txn, cleared: boolean) => void) | undefined;
  /**
   * Open the pairing screen. Absent on the surfaces that cannot sync over a
   * local network — the web and Android — so the control is missing rather
   * than present and inert.
   */
  onDevices?: (() => void) | undefined;
  /** How many devices are connected, for the dot on that control. */
  peers?: number | undefined;
  /**
   * The cog and its menu, built once by App and handed to both screens.
   *
   * A NODE rather than four more props. Whole dollars, Import and Export are
   * App's to wire — none of them is about this screen — and threading them
   * through here only so this screen could re-assemble the same component
   * twice is how two menus end up disagreeing.
   */
  menu?: ReactNode;
  /** The accounts, in order. There is always at least one — see ensureAccount. */
  accounts: readonly Account[];
  /** How the rows are ordered inside each account. */
  sort: SortMode;
  onSort: (mode: SortMode) => void;
  /** Which accounts are folded shut, by id. */
  collapsed: readonly string[];
  onCollapsed: (ids: readonly string[]) => void;
  /** Open the account manager — the only place an account is made. */
  onManage: () => void;
  /**
   * The budget lines, for the category column. Names only — a transaction
   * points at a LINE (v4), so this is what turns that id into a word.
   */
  lines: readonly Line[];
  /**
   * A stated balance for an account. Core decides whether that is a
   * difference worth a transaction; this only reports what was typed.
   */
  /**
   * The balance as stated — of the whole account, or of what has CLEARED.
   *
   * Sean, 2026-09-18: a reconcile button beside the cleared figure as well
   * as beside the balance. They are the same gesture against two numbers: the
   * statement in your hand agrees with what has cleared, not with the whole
   * ledger, and a difference there is an adjustment the bank has already
   * settled — so the row it writes is cleared too.
   */
  onReconcile: (account: string, stated: number, what: Reconciled) => void;
  /**
   * Delete everything the pick bar has picked, in one press.
   *
   * Ids rather than rows: core's `tombstoneMany` takes the ids and the store
   * already holds the records, so handing whole `Txn`s back would be giving
   * the caller a copy it has to check is still current.
   */
  onDeleteMany?: ((ids: readonly string[]) => void) | undefined;
};

export function TransactionsScreen({
  txns, onAdd, onAction, onDevices, peers = 0, menu, accounts,
  sort, onSort, collapsed, onCollapsed, onMove, onManage, lines, onReconcile,
  onInline, onDate, onCleared, onDeleteMany,
}: Props) {
  // Ordering is core's, not the list's — see spec/sort.json.
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const shown = view === null ? accounts : accounts.filter((a) => a.id === view);
  const sections = shown.map((a) => ({
    account: a,
    rows: sortTxns(txns.filter((t) => t.account === a.id), sort),
  }));
  const anyRows = sections.some((sec) => sec.rows.length > 0);

  /*
   * id -> the line's name, for the category column.
   *
   * A Map built once per render rather than a `find` per row: the ledger is
   * nearly two thousand rows after a CSV import, and a linear scan per row
   * per render is the shape that makes a list feel slow for no visible
   * reason.
   */
  const lineNames = new Map(lines.map((l) => [l.id, l.name]));
  const lineName = (id: string | null): string =>
    id === null ? '' : lineNames.get(id) ?? '';

  const toggle = (id: string) =>
    onCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]);
  /**
   * Hold an account's caret, fold or unfold EVERY account — the collapse-all
   * button's job, moved onto the control it was describing (Sean,
   * 2026-09-16, across the whole test suite).
   *
   * `wasOpen` is the state of the caret that was HELD, not a toggle of a
   * remembered all-or-nothing: hold an open one and the ledger closes, hold a
   * closed one and it opens. So "put this all away" is one gesture on
   * whatever is still open, with no button state to read first.
   *
   * `shown`, not every account: folding one that is filtered out of view
   * would leave a surprise waiting behind the next pick.
   */
  const foldAllAccounts = (wasOpen: boolean) =>
    onCollapsed(foldLevel(shown.map((a) => a.id), wasOpen));
  /**
   * Edit mode, for the whole page.
   *
   * Sean, 2026-08-21: "put a pencil icon button at the top for edit mode... no
   * more holding or double tapping for edit mode or having to exit edit mode
   * in this app." So the pencil is the only way in, EVERY row shows its
   * controls at once, and choosing one of them turns edit mode back off —
   * nobody has to remember they left it on.
   *
   * A page flag rather than a row id, and that is the substance of the change
   * rather than a detail: holding a row meant the app had a mode you could
   * enter by accident, on a gesture with no affordance, one row at a time.
   */
  const [edit, setEdit] = useState(false);
  /**
   * The rows picked out — ChefMind's selection, brought over 2026-09-21.
   *
   * NOT TIED TO EDIT MODE any more, and that is the substance of the change
   * rather than a detail. It was cleared the moment the pencil went off, on
   * the reading that a selection you cannot see will surprise you; the dot
   * is drawn on every row at all times now, so there is no such moment — the
   * selection is visible whether the pencil is on or off, and the bar at the
   * foot says how many and what they come to even when the answer is none.
   * Clear is one press, an inch from the count it acts on.
   */
  const [picked, setPicked] = useState<readonly string[]>([]);
  /**
   * The field being typed into in place, if any.
   *
   * Sean, 2026-08-21: "a single tap on a transaction's name, amount, or date
   * should start editing in place (full edit screen can be entered by going
   * into edit mode then pressing the edit button)." So the common change —
   * a typo in a name, a wrong amount — costs one tap, and the form is for
   * when you want the whole record.
   *
   * One at a time, held here rather than in the row, so opening a second
   * closes the first. Two open inline fields is two half-finished edits and
   * no way to tell which one Return will land on.
   */
  const [inline, setInline] = useState<{ id: string; field: 'name' | 'amount' } | null>(null);
  const leaveEdit = () => { setEdit(false); setSwipedId(null); };
  // Both directions clear the park. Edit mode HIDES it rather than cancelling
  // it, so without this the pencil pressed twice brought back a delete armed
  // on a row the finger left minutes ago.
  const enterEdit = () => { setSwipedId(null); setEdit(true); };
  /** The sort dropdown, open or not. Owned here so the bar row stays dumb. */
  const [sorting, setSorting] = useState(false);
  /** Is a row mid-drag anywhere? Only the ScrollView needs to know. */
  const [dragging, setDragging] = useState(false);
  /**
   * The row whose delete is parked by a swipe, if any.
   *
   * Up here rather than in the row, and one at a time, for the same reason
   * `openId` is: an armed delete left lying around under a finger that has
   * moved on is the state this app least wants.
   */
  const [swipedId, setSwipedId] = useState<string | null>(null);
  /**
   * The account whose total is open as a field, if any. One at a time, held
   * here rather than in the section, so opening a second closes the first —
   * two open reconciles is two half-stated balances and no way to tell which
   * Return will land on.
   */
  const [reconciling, setReconciling] = useState<{ account: string; what: Reconciled } | null>(null);

  // A row that stops existing — deleted here, or deleted on another device
  // mid-gesture — must not leave a parked delete behind attached to nothing.
  if (swipedId !== null && !txns.some((t) => t.id === swipedId)) setSwipedId(null);

  /**
   * ALL MEANS ALL OF WHAT IS SHOWN, and a folded account is not shown.
   *
   * The account picker narrows it, because that is a decision about scope.
   * A FOLD does not get the same treatment even though both hide rows: it
   * is the person saying "not now", and All followed by Delete taking rows
   * out from behind one is the one outcome this bar must not have. With
   * everything folded All picks nothing, and the count saying 0 is the
   * honest answer — there is nothing on the screen to pick.
   */
  const visible = sections.filter((sec) => !collapsed.includes(sec.account.id))
    .flatMap((sec) => sec.rows.map((t) => t.id));

  /**
   * EVERY DRAWN ENTRY, in one flat list — so a row can be dragged into
   * ANOTHER ACCOUNT (Sean, 2026-09-21).
   *
   * Each account owned its own `useRowDrag` until today, over its own rows,
   * so "somewhere else" was not a place the gesture could express. One hook
   * over one list is what makes it one, and core's `rowslots.ts` — the same
   * bytes CoreMind canon and three sibling apps carry — is what turns the
   * boundary a finger lands on into an account and a neighbour. Its two
   * rules, both about the HEADING: the list is exactly what is DRAWN (a
   * folded account contributes its heading and none of its rows), and the
   * heading is an entry, which is what makes "the end of this account" a
   * place a row can land rather than a boundary spanning the heading. The
   * Budget tab does the same thing with the same rule.
   */
  /*
   * NO `empty` PLACEHOLDER HERE, unlike the Budget tab.
   *
   * An empty account already draws a heading and nothing else, so the space
   * between it and the next heading is the boundary that means "into this
   * account" — the walk-back rule in `rowslots.ts` answers with the section
   * ABOVE a header, which is exactly this one, and half of each heading is
   * plenty to aim at.
   *
   * A placeholder that appeared only while a drag was live was tried first
   * and was WRONG, not merely unnecessary: it pushed every heading below it
   * down 36 points the moment a finger went down, which breaks this app's
   * one rule about drag feedback — nothing moves during a drag — and made
   * the drop land a placeholder's height short of where it was aimed. The
   * budget keeps its placeholder because a category with no lines already
   * draws a real line of text there, at rest, that a drag does not move.
   */
  type FlatEntry =
    | { kind: 'row'; rec: Txn; sectionId: string }
    | { kind: 'head'; sectionId: string };
  const flatRows: FlatEntry[] = [];
  for (const { account, rows } of sections) {
    flatRows.push({ kind: 'head', sectionId: account.id });
    if (collapsed.includes(account.id)) continue;
    for (const t of rows) flatRows.push({ kind: 'row', rec: t, sectionId: account.id });
  }

  const drag = useRowDrag(flatRows.length, (from, to) => {
    const src = flatRows[from];
    if (src?.kind !== 'row') return;
    const target = dropTarget(slotEntries(flatRows), from, to);
    if (target === null) return;
    onMove?.(src.rec, target.sectionId, target.beforeId);
  });
  useEffect(() => { setDragging(drag.dragIdx !== null); }, [drag.dragIdx]);

  const flatIdxOf = (id: string) => flatRows.findIndex((x) => x.kind === 'row' && x.rec.id === id);
  const headIdxOf = (id: string) => flatRows.findIndex((x) => x.kind === 'head' && x.sectionId === id);
  /*
   * A grip is offered when there is anywhere for the row to GO — and, as
   * before, only in CUSTOM order: a hand order the next render would undo is
   * worse than none. The test used to be "does this account hold more than
   * one row", which is the question a per-account drag asked; one row in
   * each of two accounts is now a move.
   */
  const canMove = edit && onMove !== undefined
    && (flatRows.filter((x) => x.kind === 'row').length > 1 || sections.length > 1);
  const deleteSelected = () => {
    if (onDeleteMany === undefined || picked.length === 0) return;
    onDeleteMany(picked);
    setPicked([]);
  };

  return (
    <View style={styles.fill}>
      <TopBar
        title="Transactions"
        titleTestID="title"
        controls={
          <>
            {/* The pencil. First, because it is the control that changes what
                every other row does. */}
            {onAction !== undefined && (
              <CircleBtn
                on={edit}
                onPress={() => (edit ? leaveEdit() : enterEdit())}
                label={edit ? 'Done editing' : 'Edit rows'}
                testID="edit-toggle"
              >
                <PencilIcon color={edit ? '#ffffff' : T.text} />
              </CircleBtn>
            )}
            {/* `.00` IS GONE FROM HERE. It was a round toggle between the
                pencil and the picker from 2026-09-18; on 2026-09-21 Sean
                asked for a cog menu carrying "whole dollars (which has a
                checkbox toggle)", and two controls for one setting is the
                thing this bar's comments have argued against all along. The
                box in the menu says ON or OFF in words; a filled circle
                only said it to someone who already knew what `.00` meant. */}
            {onDevices !== undefined && (
              <CircleBtn onPress={onDevices} label={peers > 0 ? `Devices, ${peers} connected` : 'Devices'} testID="devices-button">
                <>
                  <ShareIcon />
                  {peers > 0 && <View style={styles.dot} testID="devices-dot" />}
                </>
              </CircleBtn>
            )}
          </>
        }
        picker={
          <SectionPick
            label="Accounts"
            sections={accounts.map((a) => ({ id: a.id, name: a.name, color: a.color }))}
            value={view}
            onPick={setView}
            visible={picking}
            onOpen={() => setPicking(true)}
            onClose={() => setPicking(false)}
            onManage={onManage}
            compact
          />
        }
        menu={menu}
      />

      {/* Under the divider: how the list is ordered.
          The running total used to sit at the left of this row; Sean moved
          it onto each account's own heading (2026-09-15), beside the name.
          The selection's count and sum sat here next, and went down to the
          pick bar at the foot on 2026-09-21 — a count an inch from the All
          and Clear that change it, rather than at the opposite end of the
          screen from them. */}
      <BarRow>
        <View />
        {/*
          The LIST's controls, beside the sort that was already here.

          Only the sort is left here (Sean, 2026-09-18): `.00` went back up
          to the bar once the import button came down to the account line,
          and collapse-all went altogether. The row still earns its place —
          the bar is what the screen IS and this row is what the list is
          doing.
        */}
        <View style={styles.barTools}>
          <SortPick
            mode={sort}
            onPick={onSort}
            visible={sorting}
            onOpen={() => setSorting(true)}
            onClose={() => setSorting(false)}
          />
        </View>
      </BarRow>

      {/*
        `scrollEnabled` follows the content, not the container. A list that
        bounces with three rows in it reads as broken, and on the web it puts
        a scrollbar beside something that has nowhere to go.
      */}
      <ScrollView
        contentContainerStyle={styles.list}
        // A live drag holds the scroll still. The grip also refuses to hand
        // the responder over (see rowdrag), which is the load-bearing half;
        // this is so the list does not slide under a finger that is aiming.
        scrollEnabled={anyRows && !dragging}
        testID="txn-scroll"
      >
        {!anyRows && (
          <View style={styles.empty} testID="empty-state">
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>Tap + on an account to add the first one.</Text>
          </View>
        )}

        {sections.map(({ account, rows }) => (
          <Section
            key={account.id}
            account={account}
            rows={rows}
            shut={collapsed.includes(account.id)}
            onToggle={() => toggle(account.id)}
            onFoldAll={foldAllAccounts}
            onAdd={() => onAdd(account.id)}
            edit={edit}
            onEdited={leaveEdit}
            picked={picked}
            onPick={(id) => setPicked((p) => toggleSelected(p, id))}
            inline={inline}
            setInline={setInline}
            onInline={onInline}
            onDate={onDate}
            onCleared={onCleared}
            lineName={lineName}
            reconciling={reconciling}
            onReconcileOpen={(account, what) => setReconciling({ account, what })}
            onReconcile={(id, stated, what) => {
              setReconciling(null);
              if (stated !== null) onReconcile(id, stated, what);
            }}
            swipedId={swipedId}
            setSwipedId={setSwipedId}
            onAction={onAction}
            drag={drag}
            /* Dragging is offered only in CUSTOM order. Anywhere else a
               hand-placed row is a statement the app cannot keep: the next
               render puts it back, which reads as the app ignoring you. */
            canMove={canMove && sort === 'custom'}
            headIdx={headIdxOf(account.id)}
            flatIdxOf={flatIdxOf}
          />
        ))}

        {/* The boundary BELOW everything — one past the last entry, so it
            belongs to the list rather than to whichever account happens to
            be drawn last. Every other boundary is drawn by the entry under
            it. */}
        {drag.slot === flatRows.length && <View style={styles.dropLine} testID="drop-line" />}

        {/*
          The rest of the page, when a delete is parked.

          The list's content box already grows to fill the ScrollView
          (`flexGrow: 1`), so this takes whatever is left under the last row
          and makes it a way out. Rendered ONLY while something is parked:
          left there permanently it would sit over the empty state and eat
          the taps that are supposed to reach it.

          Not a screen-wide backdrop, which is the obvious shape and the
          wrong one — drawn over everything it would cover the parked delete
          itself, and the one control the gesture exists to offer would stop
          working.
        */}
        {swipedId !== null && (
          <Pressable
            style={styles.dismissRest}
            onPress={() => setSwipedId(null)}
            accessibilityLabel="Cancel delete"
            testID="swipe-dismiss"
          />
        )}
      </ScrollView>

      {/*
        THE PICK BAR, at the foot and ALWAYS DRAWN — ChefMind's, and its
        reason carries over word for word (Sean there, 2026-09-16): it is the
        only thing that says how many are picked, and appearing only once
        something was picked made the count you wanted before choosing the
        one thing you could not see, with All behind a mode.

        Under the list rather than over it, so the thumb that reaches Delete
        is nowhere near the rows it deletes; above the tab bar, which the app
        draws outside this screen.

        The sum is what this app's selection is FOR — Sean, 2026-08-21: "when
        multiple transactions are selected, show the sum of their amounts."
        It is core's `selectedTotal`, which skips an id whose row has gone
        rather than counting it as zero.
      */}
      <PickBar
        prefix="picked"
        count={picked.length}
        detail={picked.length > 0 ? formatAmount(selectedTotal(txns, picked)) : undefined}
        onAll={() => setPicked(visible)}
        onClear={() => setPicked([])}
        onDelete={deleteSelected}
      />
    </View>
  );
}

/**
 * One account, its rows, and the drag that reorders them.
 *
 * A component rather than a loop body because it OWNS a hook: each section
 * has its own `useRowDrag`, since a row only ever moves within the account it
 * belongs to. Rendering the hook inside `sections.map` would call a different
 * number of hooks whenever an account appeared or was filtered away.
 */
function Section({
  account, rows, shut, onToggle, onFoldAll, onAdd, edit, onEdited, picked, onPick,
  inline, setInline, onInline, onDate, onCleared, lineName, swipedId, setSwipedId, onAction,
  drag, canMove, headIdx, flatIdxOf,
  reconciling, onReconcileOpen, onReconcile,
}: {
  account: Account;
  rows: readonly Txn[];
  shut: boolean;
  onToggle: () => void;
  /** Fold or unfold every account; the argument is this caret's own state. */
  onFoldAll: (wasOpen: boolean) => void;
  onAdd: () => void;
  /** Is the page in edit mode? Every row shows its controls when it is. */
  edit: boolean;
  /** An action was chosen — edit mode ends, so nobody has to turn it off. */
  onEdited: () => void;
  /** The ids picked out in edit mode. */
  picked: readonly string[];
  onPick: (id: string) => void;
  inline: { id: string; field: 'name' | 'amount' } | null;
  setInline: (next: { id: string; field: 'name' | 'amount' } | null) => void;
  onInline?: ((txn: Txn, patch: { name?: string; amount?: number }) => void) | undefined;
  onDate?: ((txn: Txn) => void) | undefined;
  /** The cleared box on a row was flipped. Absent where the ledger is read-only. */
  onCleared?: ((txn: Txn, cleared: boolean) => void) | undefined;
  /** The row whose delete is parked, if any. One at a time, like openId. */
  lineName: (id: string | null) => string;
  /** The account, and which of its two figures, open as a field — if any. */
  reconciling: { account: string; what: Reconciled } | null;
  onReconcileOpen: (account: string, what: Reconciled) => void;
  /** The figure as stated, or null for a field left unreadable. */
  onReconcile: (account: string, stated: number | null, what: Reconciled) => void;
  swipedId: string | null;
  setSwipedId: (id: string | null) => void;
  /** Open the CSV import. Absent where the ledger is read-only. */
  onImport?: (() => void) | undefined;
  onAction?: ((action: RowAction, txn: Txn) => void) | undefined;
  /** The screen's one drag, over every drawn entry. */
  drag: RowDrag;
  /** Is there anywhere for a row to go, and is the order a hand order? */
  canMove: boolean;
  /** This account's heading, as an index into the screen's flat list. */
  headIdx: number;
  /** A row's index in that same list. */
  flatIdxOf: (id: string) => number;
}) {

  /*
   * A parked delete outranks this header too.
   *
   * Same rule as the rows, for the same reason: a tap that lands anywhere
   * other than the delete is a decision not to delete, and collapsing the
   * account instead would scroll the armed row out of sight while leaving it
   * armed.
   */
  const parked = swipedId !== null;
  const dismiss = () => setSwipedId(null);
  const hammerTip = useTip();
  const clearedTip = useTip();

  return (
    <View testID="account-section" style={styles.section}>
      {/* The boundary ABOVE this heading: the end of whatever is drawn over
          it. Each entry draws its own line, so only the very last boundary
          is the screen's to draw. */}
      {drag.slot === headIdx && <View style={styles.dropLine} testID="drop-line" />}
      {/* THE HEADING IS A DROP TARGET, and has to be measured to be one —
          see the screen's `flatRows`. Registered open or shut, which is what
          lets a row be dropped into a folded account. */}
      <View style={styles.head} ref={drag.registerRow(headIdx)} collapsable={false}>
        <Pressable
          onPress={parked ? dismiss : onToggle}
          // Hold it and every account follows this one — see foldAllAccounts.
          // 350, the app's one long-press threshold.
          onLongPress={() => onFoldAll(!shut)}
          delayLongPress={LONG_PRESS_MS}
          style={styles.headMain}
          accessibilityRole="button"
          accessibilityState={{ expanded: !shut }}
          accessibilityHint="Hold to fold or unfold every account"
          testID={`account-head-${account.id}`}
        >
          <Text style={[styles.chev, shut && styles.chevShut]}>⌄</Text>
          <Dot colors={[account.color]} size={11} />
          <Text style={styles.headName} numberOfLines={1}>{account.name}</Text>
        </Pressable>

        {/*
          What the account holds, IMMEDIATELY right of its name, and the
          hammer that reconciles it right of that — Sean's placement,
          2026-09-15, second pass: "move the green amount to the right of the
          account name, the gray hammer button should be to the right of that
          green amount, remove the gray amount". This is the green running
          total the bar under the title used to carry, now per account and
          beside the name it belongs to; the grey copy that sat at the right
          margin is gone. Green when the account is in credit, dim otherwise,
          the same rule the bar's total followed.

          Outside the folding Pressable on purpose: they are their own
          controls, and inside it a tap meant to reconcile would fold the
          section instead.
        */}
        {reconciling?.account === account.id && reconciling.what === 'total' ? (
          <ReconcileField
            value={total(rows)}
            onDone={(stated) => onReconcile(account.id, stated, 'total')}
            testID={`account-reconcile-input-${account.id}`}
          />
        ) : (
          <Text
            style={[styles.headSum, total(rows) > 0 && styles.totalUp]}
            testID={`account-total-${account.id}`}
            accessibilityLabel={`Total ${formatAmount(total(rows))}`}
          >
            {formatAmount(total(rows))}
          </Text>
        )}
        <Pressable
          onPress={parked ? dismiss : () => onReconcileOpen(account.id, 'total')}
          onHoverIn={hammerTip.hover.onHoverIn}
          onHoverOut={hammerTip.hover.onHoverOut}
          style={styles.headHammer}
          accessibilityRole="button"
          accessibilityLabel={`Reconcile ${account.name}`}
          testID={`account-reconcile-${account.id}`}
        >
          <HammerIcon />
          {/* The VERB only, where the accessibility label names the account
              too: a bubble hanging off this hammer is already beside the
              account it belongs to. */}
          <TipBubble text="Reconcile" shown={hammerTip.shown} />
        </Pressable>

        {/*
          WHAT THE BANK HAS CONFIRMED, right of the hammer — Sean,
          2026-09-18, and right of the hammer is the placement, not a
          consequence of the layout. The number beside the name is everything
          the ledger knows; this is the part a statement would agree with, and
          the two together say how much is still in the air.

          Labelled, where the total beside the name is not: an unlabelled
          second figure on the same line is two numbers and no way to tell
          which is which.

          STACKED, label over amount, because `Cleared: $3,457.17` on one line
          is 92 points and the head has 343 of them on a phone — which it
          spent, and the account NAME was what gave, drawing `Account` as
          `Acco…`. The same two words over each other are 52, and they read
          as the column heading this is.
        */}
        <View
          style={styles.headCleared}
          testID={`account-cleared-${account.id}`}
          accessibilityLabel={`Cleared ${formatAmount(clearedTotal(rows))}`}
        >
          <Text style={styles.headClearedLabel}>Cleared</Text>
          {reconciling?.account === account.id && reconciling.what === 'cleared' ? (
            <ReconcileField
              value={clearedTotal(rows)}
              onDone={(stated) => onReconcile(account.id, stated, 'cleared')}
              style={styles.headClearedNum}
              testID={`account-reconcile-cleared-input-${account.id}`}
            />
          ) : (
            <Text style={styles.headClearedNum} numberOfLines={1}>
              {formatAmount(clearedTotal(rows))}
            </Text>
          )}
        </View>
        {/*
          A SECOND HAMMER, for the cleared figure — Sean, 2026-09-18. The
          statement in your hand is a statement about what has CLEARED, so
          this is the one you reconcile against it; the first hammer states
          the whole balance, cash in the drawer included. Same field, same
          arithmetic, and the row it writes is cleared, because a difference
          the bank has already settled is by definition on the statement.
        */}
        <Pressable
          onPress={parked ? dismiss : () => onReconcileOpen(account.id, 'cleared')}
          onHoverIn={clearedTip.hover.onHoverIn}
          onHoverOut={clearedTip.hover.onHoverOut}
          style={styles.headHammer}
          accessibilityRole="button"
          accessibilityLabel={`Reconcile what has cleared in ${account.name}`}
          testID={`account-reconcile-cleared-${account.id}`}
        >
          <HammerIcon />
          <TipBubble text="Reconcile cleared" shown={clearedTip.shown} />
        </Pressable>

        {/* Whatever the row has left, so the + keeps the right-hand edge. */}
        <View style={styles.headSpacer} />

        {/*
          IMPORT, left of the + — Sean, 2026-09-18. It was a circle in the
          top bar; the account line is where the rows it makes will land, and
          the bar is what the screen is rather than what a list does. Hammer-
          sized rather than a 44-point circle: the head has nothing to spare
          on a phone, and the target is the row's full height either way.
        */}
        {/* THE IMPORT ARROW IS GONE FROM HERE — Sean, 2026-09-21: "drop the
            import button next to the + button in transactions." It came down
            to the account line on 2026-09-18 to give the top bar room, and
            it never belonged on a heading: an import is not about the
            account whose + happens to be beside it, it opens a screen that
            asks which account to file into. It is a row in the cog menu now. */}

        {/* Each account adds into ITSELF: the + is the only thing that tells
            the form which section it was opened from. */}
        <Pressable
          onPress={parked ? dismiss : onAdd}
          style={styles.headAdd}
          accessibilityRole="button"
          accessibilityLabel={`Add to ${account.name}`}
          testID={`account-add-${account.id}`}
        >
          <Text style={styles.headAddText}>+</Text>
        </Pressable>
      </View>

      {!shut && rows.map((t) => {
        const i = flatIdxOf(t.id);
        return (
        <View key={t.id} ref={drag.registerRow(i)} collapsable={false}>
          {/* One line, at the boundary the row would land on. Nothing else
              moves while a drag is live — a list that rearranges under a
              moving finger is a list you cannot aim at. */}
          {drag.slot === i && <View style={styles.dropLine} testID="drop-line" />}
          <Row
            txn={t}
            edit={edit && onAction !== undefined}
            picked={picked.includes(t.id)}
            onPick={() => onPick(t.id)}
            inline={inline?.id === t.id ? inline.field : null}
            onOpenInline={(field) => setInline({ id: t.id, field })}
            onCloseInline={() => setInline(null)}
            onInline={onInline === undefined ? undefined : (patch) => onInline(t, patch)}
            onDate={onDate === undefined ? undefined : () => onDate(t)}
            onCleared={onCleared === undefined ? undefined : (c) => onCleared(t, c)}
            onAction={(a) => { setSwipedId(null); onEdited(); onAction?.(a, t); }}
            grip={canMove ? drag.gripFor(i) : undefined}
            lifted={drag.dragIdx === i}
            dy={drag.dragIdx === i ? drag.dragDy : 0}
            lineName={lineName(t.category)}
            swiped={swipedId === t.id}
            parked={swipedId !== null}
            onDismiss={() => setSwipedId(null)}
            onSwipe={() => setSwipedId(t.id)}
          />
        </View>
        );
      })}
    </View>
  );
}

function Row({
  txn, edit, picked, onPick, inline, onOpenInline, onCloseInline, onInline, onDate, onCleared,
  onAction, grip, lifted, dy, swiped, parked, lineName, onDismiss, onSwipe,
}: {
  txn: Txn;
  /** Is the page in edit mode? Then this row shows its controls. */
  edit: boolean;
  /** Is this row picked out? */
  picked: boolean;
  /** A tap in edit mode picks it, or puts it back. */
  onPick: () => void;
  /** Which of this row's fields is being typed into, if any. */
  inline: 'name' | 'amount' | null;
  onOpenInline: (field: 'name' | 'amount') => void;
  onCloseInline: () => void;
  /** Commit an in-place edit. Absent where the ledger is read-only. */
  onInline?: ((patch: { name?: string; amount?: number }) => void) | undefined;
  /** The date was tapped. */
  onDate?: (() => void) | undefined;
  /** The cleared box was tapped; `cleared` is what it now says. */
  onCleared?: ((cleared: boolean) => void) | undefined;
  onAction: (action: RowAction) => void;
  /**
   * Pan handlers for the grip, or nothing when this row cannot be moved.
   *
   * The grip's SPACE is reserved either way — CalMind's rule, and the reason
   * for it is that a handle which appears and disappears shifts every name on
   * the screen sideways the moment the sort changes.
   */
  grip?: PanResponderInstance['panHandlers'] | undefined;
  /** Is this the row riding the finger? */
  lifted: boolean;
  /** How far it has travelled. */
  dy: number;
  /** Is this row's delete parked at its right edge? */
  swiped: boolean;
  /** Is ANY row's delete parked? Then every tap in here is a dismiss. */
  parked: boolean;
  /** What this row is filed against, already resolved to a word. */
  lineName: string;
  /** Put away a parked delete — a tap on any row does it. */
  onDismiss: () => void;
  /** A firm left swipe landed — park the delete. */
  onSwipe: () => void;
}) {
  /*
   * Swipe left to bring up a delete BUTTON.
   *
   * It used to slide the row and delete it outright when you let go. Sean,
   * 2026-08-21: the swipe should bring up a delete button, and it should not
   * shift things. Both halves of that are now true — the row NEVER moves, and
   * the gesture destroys nothing. It parks a control, and one more tap on that
   * control is what deletes.
   *
   * Nothing is translated, so there is no feedback mid-gesture. That is
   * deliberate and it is CalMind's answer to the same complaint: a row that
   * slides has to slide back, and everything laid out beside it moves twice
   * for one gesture that may not have meant anything.
   *
   * The gesture is claimed only once it is clearly HORIZONTAL and past a few
   * pixels — a list that grabs every touch cannot be scrolled, and one that
   * grabs at one pixel fires on a tap that wobbled. Both thresholds and both
   * decisions are core's; see `claimsSwipe` and `swipeArms`.
   */
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => claimsSwipe(g.dx, g.dy),
      onPanResponderRelease: (_e, g) => { if (swipeArms(g.dx)) onSwipe(); },
    }),
  ).current;

  /*
   * What a tap does, decided ONCE for the whole row.
   *
   * The row body and the three fields each used to answer for themselves,
   * and the fields answered first — being on top — so a parked delete was
   * dismissable only by the strip of background between them. See core's
   * `rowTap`; the precedence is the rule, and this is the one place that
   * reads it.
   */
  const tap = rowTap(parked, edit);
  /** The tap handler every part of the row shares, `undefined` for none. */
  const onTap = (own: (() => void) | undefined): (() => void) | undefined =>
    tap === 'dismiss' ? onDismiss : tap === 'pick' ? onPick : own;

  return (
    <View testID="txn-row">
      <Animated.View
        style={{ transform: [{ translateY: dy }], zIndex: lifted ? 2 : 0 }}
        {...pan.panHandlers}
      >
      <Pressable
        /*
         * The row's own background, under `rowTap` like everything else in
         * here. `undefined` for its own meaning: outside edit mode a tap on
         * the bare strip beside a field means nothing, because there is no
         * hold gesture any more and no mode to fall into by accident.
         */
        onPress={onTap(undefined)}
        style={[
          styles.row,
          edit && !picked && styles.rowOpen,
          picked && styles.rowPicked,
          lifted && styles.rowLifted,
        ]}
        accessibilityState={{ selected: picked }}
        testID="txn-row-body"
      >
      {/*
        The grip, to the left of everything — Sean's ask, and CalMind's shape.
        Drawn faint and always occupying its 16 points: hidden by OPACITY, not
        by being absent, so turning custom order on does not slide every name
        in the ledger sideways.
      */}
      <View
        style={[styles.grip, grip === undefined && styles.gripOff]}
        pointerEvents={grip === undefined ? 'none' : 'auto'}
        accessibilityLabel="Drag to reorder"
        testID="row-grip"
        {...(grip ?? {})}
      >
        <Text style={styles.gripText}>≡</Text>
      </View>
      {/*
        THE SELECTOR DOT — ChefMind's, and always drawn (Sean, 2026-09-21:
        "take the 'selected' behavior from chefmind"). It was a tick that
        appeared only in edit mode, and only once the row was picked.

        Its 18 points were already reserved at all times, which is what keeps
        the ledger from shifting sideways as a mode turns on — the grip has
        the same rule, and the tick was written without it once and the
        geometry test caught it. What changes today is that the space now
        holds a CONTROL rather than a hidden glyph: there is a thing to press
        before anything is picked, which is the whole difference between a
        selection you can start and one you have to find a mode for.

        A CIRCLE, where the cleared box on the far right is a SQUARE. Two
        checkable things on one row that looked alike would be two things to
        read; they are the same size and the same 15 points, and the shape is
        what says which is which.

        `pickTap` and not `rowTap`: the dot has no edit-mode case, because
        picking is what it is for. The one case they share is a parked
        delete, which wins over everything — see core.
      */}
      <Pressable
        onPress={pickTap(parked) === 'dismiss' ? onDismiss : onPick}
        style={styles.pickCol}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: picked }}
        accessibilityLabel={picked ? `${txn.name} selected` : `Select ${txn.name}`}
        testID={`txn-pick-${txn.id}`}
      >
        <View style={[styles.box, styles.boxRound, picked && styles.boxPicked]}>
          {picked && <Text style={styles.boxTick}>✓</Text>}
        </View>
      </Pressable>
      <View style={styles.rowMain}>
        {inline === 'name' && onInline !== undefined ? (
          <InlineText
            value={txn.name}
            style={styles.name}
            onDone={(next) => { onCloseInline(); if (next !== txn.name) onInline({ name: next }); }}
            testID="txn-name-input"
          />
        ) : (
          <Pressable
            /*
             * In edit mode these wrappers must PICK, not do nothing.
             *
             * Left as `undefined` they still render a view that swallows the
             * press, so a tap on the name — which is most of the row —
             * selected nothing while a tap on the thin strip beside it did.
             * A tap has one meaning per mode; the wrapper has to carry it too.
             */
            onPress={onTap(onInline === undefined ? undefined : () => onOpenInline('name'))}
            testID="txn-name-tap"
          >
            <Text
              style={styles.name}
              numberOfLines={1}
              ellipsizeMode="tail"
              testID="txn-name"
            >
              {txn.name}
            </Text>
          </Pressable>
        )}
        {txn.description !== '' && (
          <Text
            style={styles.desc}
            numberOfLines={1}
            ellipsizeMode="tail"
            testID="txn-description"
          >
            {txn.description}
          </Text>
        )}
      </View>
      {/*
        What it is filed against — Sean, 2026-09-15, "a category column on
        transactions in the middle".
        
        The LINE's name, because that is what a transaction points at since
        v4; the category above it is one more hop and would not fit anyway.
        Blank rather than a dash for an unfiled row: after a CSV import the
        whole ledger is unfiled, and two thousand dashes is noise where
        nothing is the honest answer.
      */}
      <Text style={styles.cat} numberOfLines={1} ellipsizeMode="tail" testID="txn-category">
        {lineName}
      </Text>

      {/* Money in is the only row that gets a colour. Everything else is an
          expense, and colouring those red would make the whole list red —
          which is the same as colouring nothing. */}
      {inline === 'amount' && onInline !== undefined ? (
        <InlineAmount
          value={txn.amount}
          onDone={(next) => { onCloseInline(); if (next !== null && next !== txn.amount) onInline({ amount: next }); }}
          testID="txn-amount-input"
        />
      ) : (
        <Pressable
          onPress={onTap(onInline === undefined ? undefined : () => onOpenInline('amount'))}
          testID="txn-amount-tap"
        >
          <Text
            style={[styles.amount, txn.amount > 0 && styles.amountUp]}
            testID="txn-amount"
          >
            {formatAmount(txn.amount)}
          </Text>
        </Pressable>
      )}
      {/* To the RIGHT of the amount, on the same line — Sean, 2026-08-21. It
          sat under it, which cost every row a second line for four
          characters and left the amounts and the dates in one ragged
          column. A tap opens the day grid: a date is picked, never typed. */}
      <Pressable
        onPress={onTap(onDate)}
        testID="txn-date-tap"
      >
        <Text style={styles.date} testID="txn-date">{formatDay(txn.date)}</Text>
      </Pressable>
      {/*
        CLEARED — the far-right column (Sean, 2026-09-15): has this row shown
        up on the statement? A checkbox because it is a per-row yes/no flipped
        often, the same box the budget's snooze wears. Its 22 points are
        reserved whether or not the ledger can be edited, so the dates stay in
        one column and nothing slides when a read-only view is drawn. Under
        `rowTap` like every other part of the row: in edit mode a tap picks,
        with a delete parked it dismisses, otherwise it flips the flag.
      */}
      <Pressable
        onPress={onTap(onCleared === undefined ? undefined : () => onCleared(txn.cleared !== true))}
        style={styles.clearedCol}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: txn.cleared === true }}
        accessibilityLabel={txn.cleared ? `${txn.name} cleared` : `${txn.name} not cleared`}
        testID={`txn-cleared-${txn.id}`}
      >
        <View style={[styles.box, txn.cleared && styles.boxOn]}>
          {txn.cleared && <Text style={styles.boxTick}>✓</Text>}
        </View>
      </Pressable>
      </Pressable>
      </Animated.View>

      {edit && (
        <View style={styles.rowActions} testID="row-actions" pointerEvents="box-none">
          {/*
            Right to left: delete, copy, duplicate, edit. Delete is the one
            that cannot be undone, so it sits furthest from where a thumb
            rests, and edit — the one reached for most — sits nearest.
          */}
          {/*
            Pinned to the RIGHT, and only as wide as the buttons it holds.

            It used to span the row — `left: 0, right: 0` — with a nearly
            opaque background, so opening a row blanked the whole thing: the
            name and the amount went, and four labelled buttons appeared where
            a transaction had been. That is what reads as things moving. The
            cluster covers what it must and no more; the name stays where it
            was, which is the point of not shifting anything.
          */}
          {/* The cluster paints its own opaque ground so the text under it
              reads as elided. That ground has to follow the row's STATE as
              well: left at T.bg, a picked row's tint stopped dead where the
              buttons began and the row looked half-painted. */}
          <View
            style={[styles.actionCluster, picked && styles.actionClusterPicked]}
            testID="row-action-cluster"
          >
            <Action label="Edit" onPress={() => onAction('edit')} testID="row-edit">
              <PencilIcon />
            </Action>
            <Action label="Duplicate" onPress={() => onAction('duplicate')} testID="row-duplicate">
              <DuplicateIcon />
            </Action>
            <Action label="Copy" onPress={() => onAction('copy')} testID="row-copy">
              <ClipboardIcon />
            </Action>
            <Action label="Delete" onPress={() => onAction('delete')} testID="row-delete" danger>
              <XIcon />
            </Action>
          </View>
        </View>
      )}

      {/*
        The parked delete: the swipe's whole result.

        ABSOLUTE, pinned to the row's right edge and out of the flex flow, with
        an OPAQUE background — the same shape as the action cluster above and
        for the same reason. As a flex child it would squeeze the row's
        contents and everything in it would slide left the moment the control
        appeared, which is the shifting Sean asked to be rid of. Opaque rather
        than translucent so what it covers reads as elided rather than as two
        things printed on top of each other.

        It is armed: the swipe was the decision, this is the confirmation, and
        one tap deletes. Tapping the row instead puts it away.
      */}
      {swiped && !edit && (
        <View style={styles.swipePark} testID="swipe-park">
          <Action label="Delete" onPress={() => onAction('delete')} testID="swipe-delete" danger>
            <XIcon />
          </Action>
        </View>
      )}
    </View>
  );
}

/**
 * The share mark: an arrow leaving an open box.
 *
 * Drawn from two Views rather than set as a character. There is no icon set
 * in this project, and no single glyph renders as the share mark across a
 * browser, a phone and a Mac — the nearest candidates fall back to a box on
 * at least one of them. Two borders and an arrow are the same everywhere.
 */
function ShareIcon() {
  return (
    <View style={styles.share} testID="share-icon">
      <Text style={styles.shareArrow}>↑</Text>
      <View style={styles.shareTray} />
    </View>
  );
}

/**
 * The account's total, swapped for a field in place.
 *
 * Seeded with the CANONICAL string rather than the formatted one — `1234.56`,
 * not `$1,234.56` — because it is read back by `parseAmount`, the full
 * parser, not by the till rule. A balance is a considered number read off a
 * statement, where `1234` plainly means one thousand two hundred and
 * thirty-four, and reading it as $12.34 would be the kind of silent
 * hundred-fold error this ledger exists to refuse.
 *
 * Blur commits, like every other field here, and an unreadable one commits
 * NOTHING rather than a zero: a balance nobody typed must never become an
 * adjustment.
 */
/** Which of an account's two figures a reconcile is stating. */
export type Reconciled = 'total' | 'cleared';

function ReconcileField({ value, onDone, style, testID }: {
  value: number;
  onDone: (stated: number | null) => void;
  /** The face of the figure it replaces — the total's by default. */
  style?: object;
  testID: string;
}) {
  const [text, setText] = useState(() => amountInput(value));
  const field = useRef<TextInput>(null);
  // The same opening-blur guard the budget's rename needs: the tap that
  // mounts this field finishes on the document and takes focus with it.
  const opened = useRef(Date.now());
  return (
    <TextInput
      ref={field}
      value={text}
      onChangeText={setText}
      onBlur={() => {
        if (Date.now() - opened.current < 250) { field.current?.focus(); return; }
        onDone(parseAmount(text));
      }}
      onSubmitEditing={() => onDone(parseAmount(text))}
      style={[style ?? styles.headSum, styles.reconcileField]}
      autoFocus
      selectTextOnFocus
      keyboardType="numbers-and-punctuation"
      inputMode="text"
      returnKeyType="done"
      testID={testID}
    />
  );
}

/**
 * A row's text, swapped for a field in place.
 *
 * The field wears the SAME type and no padding of its own, so swapping one
 * for the other changes no measurement — the row is 36 and stays 36. CalMind
 * learned this the hard way on its inline editor and says so in its styles;
 * an inline edit that nudges the row is worse than a screen, because the
 * thing you were aiming at moves as you touch it.
 *
 * Blur commits, and so does Return. There is no cancel and no confirm: the
 * change is one field, it is visible the moment it lands, and tapping it
 * again is how it is undone.
 */
function InlineText({ value, style, onDone, testID }: {
  value: string;
  style: object;
  onDone: (next: string) => void;
  testID: string;
}) {
  const [text, setText] = useState(value);
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={() => onDone(text.trim())}
      onSubmitEditing={() => onDone(text.trim())}
      style={[style, styles.inlineField]}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
      testID={testID}
    />
  );
}

/**
 * The same, for an amount, with a − beside it.
 *
 * Sean, 2026-08-21: a smaller field and a − button to its left. The sign is
 * the thing most often wrong about an amount in a ledger — a payment typed as
 * income is wrong by twice its own size — and reaching for a keyboard's minus
 * to fix it is a worse gesture than a button that is already there.
 *
 * The sign lives in the TEXT, as a leading '-', exactly as it does on the add
 * form. One source of truth means the button and the keyboard cannot
 * disagree, which they would the moment the sign became a second piece of
 * state.
 *
 * Seeded with the CANONICAL string and read back through the entry rules —
 * the same pair the add form uses, so a number typed here and one typed there
 * mean the same thing. An unparseable value commits nothing rather than
 * writing a zero.
 */
/**
 * Stop a press from moving focus off whatever has it. WEB ONLY.
 *
 * `preventDefault` on mousedown is what keeps a text field focused when a
 * button beside it is pressed. Without it the field blurs, and blur is what
 * commits — so the − flipped the sign and closed the editor in the same
 * gesture, which looked like the button doing nothing. A guard flag did not
 * save it either: whether `onPressIn` lands before the blur is not something
 * to bet on across two platforms.
 *
 * Typed loosely because it is a DOM prop react-native-web passes through and
 * the React Native types do not describe. Inert on a device, where a touch
 * does not move focus this way.
 */
const KEEP_FOCUS = {
  onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
} as unknown as Record<string, unknown>;

function InlineAmount({ value, onDone, testID }: {
  value: number;
  onDone: (next: number | null) => void;
  testID: string;
}) {
  /*
   * The digits and the sign are SEPARATE, and that is the change.
   *
   * They used to be one string with a leading `-`, so the field drew the
   * minus as well as the button beside it — the same fact twice, in two
   * places, one of them a text cursor away from being edited into something
   * else. Sean, 2026-08-21: "don't show the - in the input field and only
   * allow numbers to be typed."
   *
   * So the field holds digits (see core's `amountDigits`, which drops a typed
   * minus like any other stray character) and the button holds a boolean, and
   * `signedCents` is the one place they are put back together.
   */
  const [digits, setDigits] = useState(() => amountDigits(amountInput(value)));
  const [negative, setNegative] = useState(value < 0);
  const field = useRef<TextInput>(null);
  /*
   * Pressing the − BLURS the field, and blur is what commits.
   *
   * Without this the sign button closed the editor and wrote the value before
   * the flip was applied — the button appeared to do nothing at all. The flag
   * is set on pressIN, which lands before the blur, so the blur handler knows
   * to sit this one out and hand focus back. CalMind's edit cluster carries
   * the same machinery for the same reason.
   */
  const flipping = useRef(false);
  const done = () => onDone(signedCents(digits, negative, 'cents'));

  return (
    <View style={styles.inlineAmountRow}>
      <Pressable
        /*
         * The flip happens on pressIN, not on press, and that ordering is the
         * whole fix.
         *
         * Pressing the button blurs the field, and blur is what commits. With
         * the flip on `onPress` — after the blur — the editor closed and wrote
         * the OLD value, so the button appeared to do nothing at all. A guard
         * flag alone did not save it either: whether pressIn beats blur is not
         * something to bet on across web and native.
         *
         * Doing the flip first makes the outcome right under BOTH orderings.
         * If the guard holds, the field stays open showing the new sign; if
         * the blur wins anyway, what it commits is the flipped value. The
         * refocus below is the nicety, not the correctness.
         */
        onPressIn={() => {
          flipping.current = true;
          setNegative((n) => !n);
        }}
        onPress={() => { field.current?.focus(); }}
        {...KEEP_FOCUS}
        style={[styles.inlineSign, negative && styles.inlineSignOn]}
        accessibilityRole="button"
        accessibilityLabel="Negative"
        accessibilityState={{ selected: negative }}
        testID="txn-amount-sign"
      >
        <Text style={[styles.inlineSignText, negative && styles.inlineSignTextOn]}>
          −
        </Text>
      </Pressable>
      <TextInput
        ref={field}
        value={digits}
        onChangeText={(raw) => setDigits(amountDigits(raw))}
        onBlur={() => {
          if (flipping.current) { flipping.current = false; return; }
          done();
        }}
        onSubmitEditing={done}
        style={[styles.amount, styles.inlineField, styles.inlineAmount]}
        autoFocus
        selectTextOnFocus
        // A NUMBER pad now, not punctuation: with the sign gone from the
        // text there is nothing here to type but digits and a dot, and a
        // keyboard offering a minus key would be offering a key that does
        // nothing. The cost is iOS's return key, which a number pad has none
        // of — tapping away still commits, which is the documented way out.
        keyboardType="decimal-pad"
        inputMode="decimal"
        returnKeyType="done"
        testID={testID}
      />
    </View>
  );
}

/**
 * A row control: a 30-point circle inside a 36-point target.
 *
 * Circles with icons rather than words — Sean, 2026-08-21, matching CalMind,
 * and four text labels never fitted a phone anyway: `Edit` was the one pushed
 * off the end, which is the one people reach for most.
 *
 * 36, not the 44 everything else in this app is drawn at, and this is the one
 * deliberate exception in the codebase. The row is 36 points tall and the
 * cluster is pinned inside it; a 44-point control would OVERFLOW the row and
 * hang over its neighbours — which is precisely the bug being fixed here,
 * since `action` carried `minHeight: TAP` while the row shrank to 36 and the
 * cluster visibly bulged out of it. A control that overlaps the row above is
 * worse than one eight points short of the guideline, and CalMind draws the
 * same cluster at 24 with a hitSlop that does nothing on the web.
 */
function Action({ label, onPress, testID, danger = false, children }: {
  label: string; onPress: () => void; testID: string; danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.actionHit}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={[styles.action, danger && styles.actionDanger]}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.md,
  },
  title: { color: T.text, fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  total: { color: T.dim, fontSize: 15, marginTop: 2 },
  barTools: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  totalUp: { color: T.positive },
  // Drawn at TAP, not padded up to it: hitSlop does nothing on the web.
  add: {
    width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: T.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  addText: { color: '#ffffff', fontSize: 28, lineHeight: 32, fontWeight: '300' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  devices: {
    width: TAP, height: TAP, borderRadius: TAP / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  share: { alignItems: 'center', justifyContent: 'center' },
  shareArrow: { color: T.text, fontSize: 17, lineHeight: 18, fontWeight: '600' },
  shareTray: {
    width: 15, height: 9, marginTop: -3,
    borderWidth: 1.75, borderTopWidth: 0, borderColor: T.text,
    borderBottomLeftRadius: 3, borderBottomRightRadius: 3,
  },
  // Presence, not a count: the number is on the Devices screen.
  dot: {
    // Overhanging the ring rather than inside it: the ring is 32 now, and a
    // dot 8 in from its corner lands most of the way to the middle.
    position: 'absolute', top: -1, right: -1, width: 8, height: 8,
    borderRadius: 4, backgroundColor: T.positive,
    borderWidth: 1.5, borderColor: T.bg,
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm,
  },
  // 18 between sections, CalMind's number, and the reason it is that large:
  // a section head is a LABEL over a group, and with 8 either side it reads
  // as another row of the group above it.
  list: { paddingHorizontal: SPACE.lg, paddingBottom: 48, flexGrow: 1, gap: 18 },
  // Whatever the sections leave over. A minimum so a full list still offers
  // a patch of nothing to tap; `flex: 1` alone is zero when the rows already
  // fill the screen, which is exactly when a way out is hardest to find.
  dismissRest: { flex: 1, minHeight: 72 },
  section: { gap: SPACE.sm },
  head: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: SPACE.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
    // Above the rows under it, so the hammer's tip hangs over the first one
    // rather than behind it.
    zIndex: 2,
  },
  // No `flex: 1` any more: the name is followed by the total and the hammer,
  // and a heading that grabbed the whole row pushed both to the far edge. It
  // shrinks (the name truncates) rather than grows; headSpacer takes the rest.
  headMain: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexShrink: 1, minWidth: 0, minHeight: TAP },
  // A 20x20 box, not the glyph's own. Written with a width and no height the
  // box IS the chevron — 7pt tall against the 20 everything else gets — and
  // on the web, where hitSlop does nothing, that is the whole target.
  chev: { color: T.dim, fontSize: 15, width: 20, height: 20, lineHeight: 20, textAlign: 'center' },
  chevShut: { transform: [{ rotate: '-90deg' }] },
  // GOLD, and the only gold on the screen. CalMind's `secName` exactly: a
  // section is not a row, and a grey heading over grey rows is a list with no
  // shape to it — which is what "looks terrible" was looking at.
  headName: { color: T.gold, fontSize: 16, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  // 15, the bar total's size — this IS that number, moved. Dim until the
  // account is in credit, when `totalUp` turns it green.
  //
  // A GAP ON BOTH SIDES (Sean, 2026-09-16: "pad a tiny bit more space to the
  // left and right of the number"). It had 4 on the left and none at all on
  // the right, so it read as belonging to the hammer it was touching rather
  // than to the account name it reports. 8 either side is the scale's next
  // step and the same gap the name keeps from the dot.
  headSum: {
    color: T.dim, fontSize: 15, fontVariant: ['tabular-nums'],
    // 6, not SPACE.sm: the head grew a second hammer on 2026-09-18 and the
    // NAME is what gives when the row is short — at 375 points every two
    // points here were two points off `Account`.
    marginLeft: 6, marginRight: 6,
  },
  // The SAME margins as the number it replaces. The field already wears the
  // same type and no padding for this reason — swapping one for the other
  // must not move the hammer beside it.
  reconcileField: {
    padding: 0, margin: 0, marginLeft: SPACE.sm, marginRight: SPACE.sm,
    minWidth: 90, textAlign: 'left', color: T.text,
  },
  // 26 drawn, two of them now; the glyph is 14 and the target is the row's
  // full height, so the width was never the hit area.
  headHammer: {
    width: 26, height: TAP, alignItems: 'center', justifyContent: 'center',
  },
  // Smaller and dimmer than the account's own total: it is the second thing
  // on the line, and drawing it at the same weight would make the head read
  // as two totals arguing.
  // No padding of its own: a hammer sits either side of it now, and each one
  // is the gap.
  headCleared: { alignItems: 'flex-end', flexShrink: 0 },
  headClearedLabel: {
    color: T.faint, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 11,
  },
  headClearedNum: { color: T.faint, fontSize: 12, lineHeight: 14, fontVariant: ['tabular-nums'] },
  headSpacer: { flex: 1 },
  headAdd: {
    width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center',
  },
  headAddText: { color: T.accent, fontSize: 22, lineHeight: 24, fontWeight: '400' },
  // 2pt of accent at the boundary the row would land on, and nothing else
  // moves — the whole of the drag's feedback.
  dropLine: { height: 2, backgroundColor: T.accent, borderRadius: 1, marginVertical: 1 },
  // 16 wide, always. Hidden by opacity rather than by being absent, so
  // switching sort order cannot slide every name in the ledger sideways.
  grip: { width: 16, alignItems: 'center', justifyContent: 'center' },
  gripOff: { opacity: 0 },
  gripText: { color: T.faint, fontSize: 15 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    // 10 between the grip, the name and the amount; 8 of padding on a 36
    // minimum. CalMind's row, and the ledger was drawing 44pt rows with 12 —
    // half again the height for the same words, which is why six
    // transactions filled a phone.
    gap: 10, paddingVertical: SPACE.sm, minHeight: 36,
    // lineSoft, not cardEdge: cardEdge is the edge of a CONTROL, and between
    // two rows a line that strong reads as a spreadsheet.
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.lineSoft,
    /*
     * OPAQUE, and this is the whole reason the list was readable in a test
     * and red on a phone.
     *
     * The delete backdrop below sits behind the row and is meant to be
     * revealed by the swipe. A row with no background of its own reveals it
     * at rest: every row in the ledger drew solid red under its own text,
     * with `Delete` printed across the amount. Sean saw it on the phone
     * ("transactions don't show up well under a section") — a description
     * that sounds like spacing and was actually this.
     *
     * Nothing caught it because nothing could: the backdrop is CORRECTLY in
     * the DOM and correctly visible at all times — it is the row on top of it
     * that had gone see-through. `toBeVisible()` on either one is true in the
     * broken app and in the fixed one. What separates them is whether this
     * background exists, so that is what rowactions.spec asserts.
     */
    backgroundColor: T.bg,
  },
  rowOpen: { opacity: 0.55 },
  // A picked row comes back to full strength and gets a tinted ground: in
  // edit mode everything is dimmed, so being NOT dimmed is what reads as
  // chosen without adding another colour to the row.
  rowPicked: { backgroundColor: T.card },
  // The selector column, mirroring `clearedCol` at the other end of the row:
  // the same 15pt box in a column of its own, with the row's full height as
  // the target. 18 rather than 22 because the grip is already 16 to its left
  // and the two together are the indent every name in the ledger sits behind.
  pickCol: { width: 18, alignItems: 'center', justifyContent: 'center' },
  // The dragged row dims and rides the finger. It does not grow, tilt or cast
  // a shadow: the list is holding still around it, and the only question the
  // feedback has to answer is "which row am I holding".
  rowLifted: { opacity: 0.7, backgroundColor: T.card },
  // `rowActions`, not `actions`: the header already has one of those, and a
  // duplicate key in a StyleSheet is a typecheck error rather than a subtle
  // wrong-looking row, which is the only reason this was noticed at once.
  /*
   * Absolutely positioned OVER the row, not under it.
   *
   * Laid out in flow, opening a row pushed everything below it down — so the
   * list moved under the thumb at the exact moment a person was aiming at
   * one of four small buttons, and the row they were looking at slid away.
   * Overlaying costs nothing and keeps the list still.
   */
  // TRANSPARENT and full width: this layer exists only to catch a tap
  // anywhere on the row, which is how the controls are dismissed. The opaque
  // part is the cluster inside it.
  rowActions: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  // Pinned right, out of the flex flow, OPAQUE — the same shape as the swipe
  // park below and for the same two reasons: as a flex child it would squeeze
  // the row's contents sideways, and a translucent background leaves the text
  // it covers showing through the buttons.
  actionCluster: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    paddingLeft: SPACE.md, backgroundColor: T.bg,
  },
  actionClusterPicked: { backgroundColor: T.card },
  swipePark: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: SPACE.md, backgroundColor: T.bg,
  },
  // No padding and no border of its own: a field that swaps in for text has
  // to occupy exactly what the text did, or the row moves as it is touched.
  inlineField: { padding: 0, margin: 0, backgroundColor: 'transparent' },
  /*
   * The − and the field are ONE control, not two things near each other.
   *
   * They were a button and a right-aligned box side by side, and the box's
   * width is not its text's: with `minWidth: 64` and the digits pushed to the
   * right edge, the gap between the − and the number was empty field, about
   * fifty points of it. On the phone that read as two unrelated controls with
   * a hole between them (Sean, 2026-08-21: "spacing of the - and cursor are
   * very weird").
   *
   * Wrapping them in one bordered pill fixes the appearance and the meaning
   * at once: whatever space is left over is now visibly INSIDE the field, and
   * the − reads as part of the thing being edited.
   */
  inlineAmountRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    paddingLeft: 3, paddingRight: SPACE.xs, borderRadius: 8,
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  /*
   * LEFT-aligned, and a fixed width rather than a minimum.
   *
   * The row's amounts are right-aligned, and inheriting that here is what put
   * fifty points of empty field between the − and the digits: a text box's
   * width is not its text's width, so right-alignment pushes the number to
   * the far edge of whatever the box happens to be. On the web the box was
   * far worse than on the phone — an `<input>` takes a default width of about
   * twenty characters unless told otherwise, so `minWidth` did nothing and
   * the gap measured 122 points.
   *
   * Left-aligned, the digits start where the − ends and any slack falls after
   * them, inside the pill. 76 fits `-1,234.56` at this size, so the field
   * does not resize while a number is being typed.
   */
  inlineAmount: { width: 76, fontSize: 14, textAlign: 'left' },
  // 22, not 44: it lives inside a 36-point row, in a pill beside a field, and
  // a control taller than its row is the bug the action cluster already had.
  inlineSign: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  inlineSignOn: { backgroundColor: T.accent, borderColor: T.accent },
  inlineSignText: { color: T.dim, fontSize: 13, fontWeight: '700' },
  inlineSignTextOn: { color: '#ffffff' },
  // The target: as tall as the row and no taller — see Action.
  actionHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  action: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  actionDanger: { backgroundColor: T.danger, borderColor: T.danger },
  /*
   * `flex: 1` already implies flexShrink, and `minWidth: 0` is what lets the
   * block go narrower than its own text wants to be. Both were here before
   * the import arrived and neither turned out to be the thing that elides —
   * three mutations of this line all stayed green, which is why the comment
   * that claimed `flexShrink` was load-bearing is gone rather than reworded.
   * What actually clips is `numberOfLines` on the Text itself.
   */
  rowMain: { flex: 1, gap: 1, minWidth: 0 },
  // The category column: narrow, dim, and allowed to vanish before the
  // numbers do — a name you cannot read is worse than a name you cannot see.
  cat: {
    color: T.dim, fontSize: 12, lineHeight: 16, width: 74, flexShrink: 1,
    textAlign: 'right',
  },
  name: { color: T.text, fontSize: 16, lineHeight: 20 },
  desc: { color: T.dim, fontSize: 13, lineHeight: 16 },
  amount: {
    color: T.text, fontSize: 16, lineHeight: 20,
    fontVariant: ['tabular-nums'], textAlign: 'right',
  },
  amountUp: { color: T.positive },
  // A fixed width so the dates line up in a column of their own rather than
  // starting wherever the amount before them happened to end.
  date: { color: T.dim, fontSize: 12, lineHeight: 16, width: 46, textAlign: 'right' },
  // The cleared column and its box — BudgetScreen's snooze box, byte for
  // byte, so the two checkboxes in this app read as one control.
  clearedCol: { width: 22, alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 15, height: 15, borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.dim,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: T.dim, borderColor: T.dim },
  // Round for the selector, square for cleared — see the dot's own note.
  boxRound: { borderRadius: 999 },
  // ACCENT, where cleared is grey. Cleared is a fact about the row that the
  // bank decided; a selection is something you are doing right now, and the
  // one colour the app uses for "you did this" is the accent.
  boxPicked: { backgroundColor: T.accent, borderColor: T.accent },
  boxTick: { color: T.bg, fontSize: 10, lineHeight: 12 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: SPACE.xs, padding: SPACE.xl },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
