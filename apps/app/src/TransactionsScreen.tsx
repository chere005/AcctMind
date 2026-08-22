/**
 * The one screen: a header that says Transactions, the running total, the
 * list, and the + that opens the form.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View, type PanResponderInstance,
} from 'react-native';
import {
  amountInput, amountIsNegative, claimsSwipe, cleanAmountText, entryCents, formatAmount,
  formatDay, rowTap, selectedTotal, sortTxns, swipeArms, toggleAmountSign, toggleSelected,
  total,
  type Account, type AmountMode, type SortMode, type Txn,
} from '@acctmind/core';
import { Dot } from './Dot';
import { SectionPick } from './SectionPick';
import { SortPick } from './SortPick';
import { ClipboardIcon, DuplicateIcon, PencilIcon, XIcon } from './Icons';
import { useRowDrag } from './rowdrag';
import { BarRow, CircleBtn, TopBar } from './TopBar';
import { SPACE, T, TAP } from './theme';

export type RowAction = 'edit' | 'duplicate' | 'copy' | 'delete';

type Props = {
  txns: readonly Txn[];
  /** Add a transaction to this account. */
  onAdd: (account: string) => void;
  /** A row was held down and an action chosen. */
  onAction?: ((action: RowAction, txn: Txn) => void) | undefined;
  /** A row was dragged to a new place in its account. */
  onMove?: ((txn: Txn, shown: readonly Txn[], index: number) => void) | undefined;
  /** One field of one row was edited in place. */
  onInline?: ((txn: Txn, patch: { name?: string; amount?: number }) => void) | undefined;
  /** The date on a row was tapped — the caller opens the day grid. */
  onDate?: ((txn: Txn) => void) | undefined;
  /**
   * Open the pairing screen. Absent on the surfaces that cannot sync over a
   * local network — the web and Android — so the control is missing rather
   * than present and inert.
   */
  onDevices?: (() => void) | undefined;
  /** How many devices are connected, for the dot on that control. */
  peers?: number | undefined;
  /**
   * How bare digits are read in the amount field.
   *
   * It lives up here rather than in the form because it is a setting, not
   * part of an entry: it holds between transactions and across launches, and
   * a switch that reset every time the form opened would have to be found and
   * flipped again on every row.
   */
  amountMode: AmountMode;
  onAmountMode: (mode: AmountMode) => void;
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
};

export function TransactionsScreen({
  txns, onAdd, onAction, onDevices, peers = 0, amountMode, onAmountMode, accounts,
  sort, onSort, collapsed, onCollapsed, onMove, onManage, onInline, onDate,
}: Props) {
  // Ordering is core's, not the list's — see spec/sort.json.
  const sum = total(txns);
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const shown = view === null ? accounts : accounts.filter((a) => a.id === view);
  const sections = shown.map((a) => ({
    account: a,
    rows: sortTxns(txns.filter((t) => t.account === a.id), sort),
  }));
  const anyRows = sections.some((sec) => sec.rows.length > 0);
  const allShut = shown.length > 0 && shown.every((a) => collapsed.includes(a.id));

  const toggle = (id: string) =>
    onCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]);
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
   * The rows picked out in edit mode.
   *
   * Cleared when edit mode ends, because a selection you cannot see is a
   * selection that will surprise you the next time you open the pencil.
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
  const leaveEdit = () => { setEdit(false); setPicked([]); setSwipedId(null); };
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

  // A row that stops existing — deleted here, or deleted on another device
  // mid-gesture — must not leave a parked delete behind attached to nothing.
  if (swipedId !== null && !txns.some((t) => t.id === swipedId)) setSwipedId(null);

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
      />

      {/* Under the divider: what the ledger comes to, and how it is ordered.
          CalMind's bar is ONE row and this app has a running total to show,
          so the total moved down here rather than growing the bar into
          something that only nearly matches. */}
      <BarRow>
        {/* The selection's sum REPLACES the running total while rows are
            picked out — "what did this weekend cost" is the question being
            asked, and two totals side by side is two numbers to tell apart
            in a row that is already full. */}
        {picked.length > 0 ? (
          <Text style={styles.picked} testID="picked-total">
            {picked.length} selected · {formatAmount(selectedTotal(txns, picked))}
          </Text>
        ) : (
          <Text
            style={[styles.total, sum > 0 && styles.totalUp]}
            testID="total"
            accessibilityLabel={`Total ${formatAmount(sum)}`}
          >
            {formatAmount(sum)}
          </Text>
        )}
        {/*
          The LIST's controls, beside the sort that was already here.

          They were in the top bar, and with the pencil added that made five
          circles across it: `Transactions` drew as `Transac…`, which is the
          same overflow the category heading had. The split is not just to
          make room — the bar is what the screen IS and this row is what the
          list is doing, and collapse and `.00` were always the second thing.
        */}
        <View style={styles.barTools}>
          <CircleBtn
            glyph={allShut ? '⌄' : '⌃'}
            on={allShut}
            onPress={() => onCollapsed(allShut ? [] : shown.map((a) => a.id))}
            label={allShut ? 'Expand all accounts' : 'Collapse all accounts'}
            testID="collapse-all"
          />
          {/* `.00` reads bare digits as whole dollars. It is a setting that
              holds between entries, which is why it is out here and not in
              the form. */}
          <CircleBtn
            glyph=".00"
            on={amountMode === 'whole'}
            onPress={() => onAmountMode(amountMode === 'whole' ? 'cents' : 'whole')}
            label="Enter whole dollars"
            testID="whole-toggle"
          />
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
            onAdd={() => onAdd(account.id)}
            edit={edit}
            onEdited={leaveEdit}
            picked={picked}
            onPick={(id) => setPicked((p) => toggleSelected(p, id))}
            inline={inline}
            setInline={setInline}
            onInline={onInline}
            onDate={onDate}
            swipedId={swipedId}
            setSwipedId={setSwipedId}
            onAction={onAction}
            /* Dragging is offered only in CUSTOM order. Anywhere else a
               hand-placed row is a statement the app cannot keep: the next
               render puts it back, which reads as the app ignoring you. */
            onMove={sort === 'custom' ? onMove : undefined}
            onDragging={setDragging}
          />
        ))}

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
  account, rows, shut, onToggle, onAdd, edit, onEdited, picked, onPick,
  inline, setInline, onInline, onDate, swipedId, setSwipedId, onAction, onMove, onDragging,
}: {
  account: Account;
  rows: readonly Txn[];
  shut: boolean;
  onToggle: () => void;
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
  /** The row whose delete is parked, if any. One at a time, like openId. */
  swipedId: string | null;
  setSwipedId: (id: string | null) => void;
  onAction?: ((action: RowAction, txn: Txn) => void) | undefined;
  onMove?: ((txn: Txn, shown: readonly Txn[], index: number) => void) | undefined;
  onDragging: (on: boolean) => void;
}) {
  const drag = useRowDrag(rows.length, (from, to) => {
    const moved = rows[from];
    if (moved !== undefined) onMove?.(moved, rows, to);
  });

  // Reported up so the ScrollView can hold still. In an effect rather than
  // during render: telling a PARENT to set state while rendering a child is
  // the render-phase update this repo has already been bitten by once.
  useEffect(() => { onDragging(drag.dragIdx !== null); }, [drag.dragIdx, onDragging]);

  // The grip is an edit-mode control like the rest. Sorting still gates it:
  // a hand order the next render would undo is worse than none.
  const canMove = edit && onMove !== undefined && rows.length > 1;

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

  return (
    <View testID="account-section" style={styles.section}>
      <View style={styles.head}>
        <Pressable
          onPress={parked ? dismiss : onToggle}
          style={styles.headMain}
          accessibilityRole="button"
          accessibilityState={{ expanded: !shut }}
          testID={`account-head-${account.id}`}
        >
          <Text style={[styles.chev, shut && styles.chevShut]}>⌄</Text>
          <Dot colors={[account.color]} size={11} />
          <Text style={styles.headName} numberOfLines={1}>{account.name}</Text>
          <Text style={styles.headSum}>{formatAmount(total(rows))}</Text>
        </Pressable>
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

      {!shut && rows.map((t, i) => (
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
            onAction={(a) => { setSwipedId(null); onEdited(); onAction?.(a, t); }}
            grip={canMove ? drag.gripFor(i) : undefined}
            lifted={drag.dragIdx === i}
            dy={drag.dragIdx === i ? drag.dragDy : 0}
            swiped={swipedId === t.id}
            parked={swipedId !== null}
            onDismiss={() => setSwipedId(null)}
            onSwipe={() => setSwipedId(t.id)}
          />
        </View>
      ))}
      {!shut && drag.slot === rows.length && <View style={styles.dropLine} testID="drop-line" />}
    </View>
  );
}

function Row({
  txn, edit, picked, onPick, inline, onOpenInline, onCloseInline, onInline, onDate,
  onAction, grip, lifted, dy, swiped, parked, onDismiss, onSwipe,
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
        accessibilityState={edit ? { selected: picked } : undefined}
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
        The tick, and its 18 points are reserved ALWAYS — not just in edit
        mode, and that is the correction rather than the detail.
        
        Drawn only when picked, it moved every name in the ledger sideways the
        moment the pencil was pressed, which is the exact shifting Sean asked
        to be rid of. The grip already had this rule; the tick was written
        without it and the geometry test caught it.
      */}
      <Text
        style={[styles.tick, !(edit && picked) && styles.tickOff]}
        testID="row-tick"
      >
        ✓
      </Text>
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
            <Text style={styles.name} numberOfLines={1} testID="txn-name">{txn.name}</Text>
          </Pressable>
        )}
        {txn.description !== '' && (
          <Text style={styles.desc} numberOfLines={1} testID="txn-description">
            {txn.description}
          </Text>
        )}
      </View>
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
  const [text, setText] = useState(() => amountInput(value));
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
  const done = () => onDone(entryCents(cleanAmountText(text), 'cents'));

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
          setText((t) => toggleAmountSign(t));
        }}
        onPress={() => { field.current?.focus(); }}
        {...KEEP_FOCUS}
        style={[styles.inlineSign, amountIsNegative(text) && styles.inlineSignOn]}
        accessibilityRole="button"
        accessibilityLabel="Negative"
        accessibilityState={{ selected: amountIsNegative(text) }}
        testID="txn-amount-sign"
      >
        <Text style={[styles.inlineSignText, amountIsNegative(text) && styles.inlineSignTextOn]}>
          −
        </Text>
      </Pressable>
      <TextInput
        ref={field}
        value={text}
        onChangeText={(raw) => setText(cleanAmountText(raw))}
        onBlur={() => {
          if (flipping.current) { flipping.current = false; return; }
          done();
        }}
        onSubmitEditing={done}
        style={[styles.amount, styles.inlineField, styles.inlineAmount]}
        autoFocus
        selectTextOnFocus
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        inputMode="text"
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
  picked: { color: T.accent, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
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
  },
  headMain: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flex: 1, minHeight: TAP },
  // A 20x20 box, not the glyph's own. Written with a width and no height the
  // box IS the chevron — 7pt tall against the 20 everything else gets — and
  // on the web, where hitSlop does nothing, that is the whole target.
  chev: { color: T.dim, fontSize: 15, width: 20, height: 20, lineHeight: 20, textAlign: 'center' },
  chevShut: { transform: [{ rotate: '-90deg' }] },
  // GOLD, and the only gold on the screen. CalMind's `secName` exactly: a
  // section is not a row, and a grey heading over grey rows is a list with no
  // shape to it — which is what "looks terrible" was looking at.
  headName: { color: T.gold, fontSize: 16, lineHeight: 20, fontWeight: '600', flex: 1 },
  headSum: { color: T.dim, fontSize: 14, fontVariant: ['tabular-nums'] },
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
  tick: { color: T.accent, fontSize: 15, fontWeight: '700', width: 18, textAlign: 'center' },
  tickOff: { opacity: 0 },
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
  rowMain: { flex: 1, gap: 1, minWidth: 0 },
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
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: SPACE.xs, padding: SPACE.xl },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
