/**
 * The one screen: a header that says Transactions, the running total, the
 * list, and the + that opens the form.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View,
  type PanResponderInstance,
} from 'react-native';
import {
  claimsSwipe, formatAmount, formatDay, sortTxns, swipeArms, total,
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
  sort, onSort, collapsed, onCollapsed, onMove, onManage,
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
  /** The row being held open, if any. One at a time, by construction. */
  const [openId, setOpenId] = useState<string | null>(null);
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
  // mid-gesture — must not leave its action bar behind attached to nothing.
  if (openId !== null && !txns.some((t) => t.id === openId)) setOpenId(null);
  if (swipedId !== null && !txns.some((t) => t.id === swipedId)) setSwipedId(null);

  return (
    <View style={styles.fill}>
      <TopBar
        title="Transactions"
        titleTestID="title"
        controls={
          <>
            <CircleBtn
              glyph={allShut ? '⌄' : '⌃'}
              on={allShut}
              onPress={() => onCollapsed(allShut ? [] : shown.map((a) => a.id))}
              label={allShut ? 'Expand all accounts' : 'Collapse all accounts'}
              testID="collapse-all"
            />
            {/* `.00` reads bare digits as whole dollars. It belongs in the bar
                rather than in the form: it is a setting that holds between
                entries, and a switch that reset every time the form opened
                would have to be found again for every transaction. */}
            <CircleBtn
              glyph=".00"
              on={amountMode === 'whole'}
              onPress={() => onAmountMode(amountMode === 'whole' ? 'cents' : 'whole')}
              label="Enter whole dollars"
              testID="whole-toggle"
            />
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
        <Text
          style={[styles.total, sum > 0 && styles.totalUp]}
          testID="total"
          accessibilityLabel={`Total ${formatAmount(sum)}`}
        >
          {formatAmount(sum)}
        </Text>
        <SortPick
          mode={sort}
          onPick={onSort}
          visible={sorting}
          onOpen={() => setSorting(true)}
          onClose={() => setSorting(false)}
        />
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
            openId={openId}
            setOpenId={setOpenId}
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
  account, rows, shut, onToggle, onAdd, openId, setOpenId, swipedId, setSwipedId,
  onAction, onMove, onDragging,
}: {
  account: Account;
  rows: readonly Txn[];
  shut: boolean;
  onToggle: () => void;
  onAdd: () => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
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

  const canMove = onMove !== undefined && rows.length > 1;

  return (
    <View testID="account-section" style={styles.section}>
      <View style={styles.head}>
        <Pressable
          onPress={onToggle}
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
          onPress={onAdd}
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
            open={openId === t.id}
            onOpen={onAction === undefined ? undefined : () => { setSwipedId(null); setOpenId(t.id); }}
            onClose={() => { setOpenId(null); setSwipedId(null); }}
            onAction={(a) => { setOpenId(null); setSwipedId(null); onAction?.(a, t); }}
            grip={canMove ? drag.gripFor(i) : undefined}
            lifted={drag.dragIdx === i}
            dy={drag.dragIdx === i ? drag.dragDy : 0}
            swiped={swipedId === t.id}
            showing={openId !== null || swipedId !== null}
            onSwipe={() => setSwipedId(t.id)}
          />
        </View>
      ))}
      {!shut && drag.slot === rows.length && <View style={styles.dropLine} testID="drop-line" />}
    </View>
  );
}

function Row({
  txn, open, onOpen, onClose, onAction, grip, lifted, dy, swiped, showing, onSwipe,
}: {
  txn: Txn;
  open: boolean;
  onOpen?: (() => void) | undefined;
  onClose: () => void;
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
  /**
   * Is anything showing anywhere — this row's controls or another row's?
   *
   * A tap on ANY row puts it away. Without this, an armed delete parked on one
   * row survived a tap on a different row: a one-press delete left lying under
   * a finger that has moved on, which is the state this app least wants.
   */
  showing: boolean;
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

  return (
    <View testID="txn-row">
      <Animated.View
        style={{ transform: [{ translateY: dy }], zIndex: lifted ? 2 : 0 }}
        {...pan.panHandlers}
      >
      <Pressable
        onLongPress={onOpen}
        // A tap puts away whatever is showing — the actions, or a parked
        // delete. An armed delete that can only be dismissed by using it is
        // a trap.
        onPress={showing ? onClose : undefined}
        // Long-press is invisible, so the row says what it offers.
        accessibilityHint={onOpen === undefined ? undefined : 'Hold for actions'}
        style={[styles.row, open && styles.rowOpen, lifted && styles.rowLifted]}
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
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={1} testID="txn-name">{txn.name}</Text>
        {txn.description !== '' && (
          <Text style={styles.desc} numberOfLines={1} testID="txn-description">
            {txn.description}
          </Text>
        )}
      </View>
      <View style={styles.rowSide}>
        {/* Money in is the only row that gets a colour. Everything else is
            an expense, and colouring those red would make the whole list
            red — which is the same as colouring nothing. */}
        <Text
          style={[styles.amount, txn.amount > 0 && styles.amountUp]}
          testID="txn-amount"
        >
          {formatAmount(txn.amount)}
        </Text>
        <Text style={styles.date} testID="txn-date">{formatDay(txn.date)}</Text>
        </View>
      </Pressable>
      </Animated.View>

      {open && (
        <View style={styles.rowActions} testID="row-actions" pointerEvents="box-none">
          {/*
            Tapping the row is how you close it — but the row is UNDER this
            overlay now and cannot be reached, so the way out has to live in
            here. Without it a person who opens a row by accident has no
            choice but to pick one of four actions, one of which deletes.
          */}
          <Pressable
            onPress={onClose}
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Close actions"
            testID="row-actions-dismiss"
          />
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
          <View style={styles.actionCluster} testID="row-action-cluster">
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
      {swiped && !open && (
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
  swipePark: {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: SPACE.md, backgroundColor: T.bg,
  },
  // The target: as tall as the row and no taller — see Action.
  actionHit: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  action: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: T.card, borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  actionDanger: { backgroundColor: T.danger, borderColor: T.danger },
  rowMain: { flex: 1, gap: 1, minWidth: 0 },
  rowSide: { alignItems: 'flex-end', gap: 1 },
  name: { color: T.text, fontSize: 16, lineHeight: 20 },
  desc: { color: T.dim, fontSize: 13, lineHeight: 16 },
  amount: { color: T.text, fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'] },
  amountUp: { color: T.positive },
  date: { color: T.dim, fontSize: 12, lineHeight: 16 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: SPACE.xs, padding: SPACE.xl },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
