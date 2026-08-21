/**
 * The one screen: a header that says Transactions, the running total, the
 * list, and the + that opens the form.
 */
import { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  claimsSwipe, formatAmount, formatDay, sortTxns, swipeDeletes, total,
  type Account, type AmountMode, type SortMode, type Txn,
} from '@acctmind/core';
import { Dot } from './Dot';
import { SectionPick } from './SectionPick';
import { SortPick } from './SortPick';
import { Toggle } from './Toggle';
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

  // A row that stops existing — deleted here, or deleted on another device
  // mid-gesture — must not leave its action bar behind attached to nothing.
  if (openId !== null && !txns.some((t) => t.id === openId)) setOpenId(null);

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title} testID="title">Transactions</Text>
          <Text
            style={[styles.total, sum > 0 && styles.totalUp]}
            testID="total"
            accessibilityLabel={`Total ${formatAmount(sum)}`}
          >
            {formatAmount(sum)}
          </Text>
        </View>
        <View style={styles.actions}>
          <Toggle
            label={allShut ? '⌄' : '⌃'}
            on={allShut}
            onPress={() => onCollapsed(allShut ? [] : shown.map((a) => a.id))}
            accessibilityLabel={allShut ? 'Expand all accounts' : 'Collapse all accounts'}
            testID="collapse-all"
          />
          <Toggle
            label=".00"
            on={amountMode === 'whole'}
            onPress={() => onAmountMode(amountMode === 'whole' ? 'cents' : 'whole')}
            accessibilityLabel="Enter whole dollars"
            testID="whole-toggle"
          />
          {onDevices !== undefined && (
            <Pressable
              onPress={onDevices}
              style={styles.devices}
              accessibilityRole="button"
              accessibilityLabel={
                peers > 0 ? `Devices, ${peers} connected` : 'Devices'
              }
              testID="devices-button"
            >
              <ShareIcon />
              {peers > 0 && <View style={styles.dot} testID="devices-dot" />}
            </Pressable>
          )}
          <Pressable
            onPress={() => onAdd(accounts[0]?.id ?? '')}
            style={styles.add}
            accessibilityRole="button"
            accessibilityLabel="Add transaction"
            testID="add-button"
          >
            <Text style={styles.addText}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.pickRow}>
        <SectionPick
          label="Accounts"
          sections={accounts.map((a) => ({ id: a.id, name: a.name, color: a.color }))}
          value={view}
          onPick={setView}
          visible={picking}
          onOpen={() => setPicking(true)}
          onClose={() => setPicking(false)}
          onManage={onManage}
        />
        <SortPick mode={sort} onPick={onSort} />
      </View>

      {/*
        `scrollEnabled` follows the content, not the container. A list that
        bounces with three rows in it reads as broken, and on the web it puts
        a scrollbar beside something that has nowhere to go.
      */}
      <ScrollView
        contentContainerStyle={styles.list}
        scrollEnabled={anyRows}
        testID="txn-scroll"
      >
        {!anyRows && (
          <View style={styles.empty} testID="empty-state">
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>Tap + on an account to add the first one.</Text>
          </View>
        )}

        {sections.map(({ account, rows }) => {
          const shut = collapsed.includes(account.id);
          return (
            <View key={account.id} testID="account-section">
              <View style={styles.head}>
                <Pressable
                  onPress={() => toggle(account.id)}
                  style={styles.headMain}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !shut }}
                  testID={`account-head-${account.id}`}
                >
                  <Text style={[styles.chev, shut && styles.chevShut]}>⌄</Text>
                  <Dot colors={[account.color]} size={12} />
                  <Text style={styles.headName} numberOfLines={1}>{account.name}</Text>
                  <Text style={styles.headSum}>{formatAmount(total(rows))}</Text>
                </Pressable>
                {/* Each account adds into ITSELF: the + is the only thing that
                    tells the form which section it was opened from. */}
                <Pressable
                  onPress={() => onAdd(account.id)}
                  style={styles.headAdd}
                  accessibilityRole="button"
                  accessibilityLabel={`Add to ${account.name}`}
                  testID={`account-add-${account.id}`}
                >
                  <Text style={styles.headAddText}>+</Text>
                </Pressable>
              </View>

              {!shut && rows.map((t, i) => (
                <Row
                  key={t.id}
                  txn={t}
                  open={openId === t.id}
                  onOpen={onAction === undefined ? undefined : () => setOpenId(t.id)}
                  onClose={() => setOpenId(null)}
                  onAction={(a) => { setOpenId(null); onAction?.(a, t); }}
                  /*
                   * Dragging is offered only in CUSTOM order, and only while
                   * the row is open. Anywhere else a drag would be a
                   * statement the app cannot keep: move a row by hand in date
                   * order and the next render puts it back, which reads as
                   * the app ignoring you.
                   */
                  onDrag={sort === 'custom' && onMove !== undefined
                    ? (steps) => onMove(t, rows, i + steps)
                    : undefined}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>

    </View>
  );
}

function Row({ txn, open, onOpen, onClose, onAction, onDrag }: {
  txn: Txn;
  open: boolean;
  onOpen?: (() => void) | undefined;
  onClose: () => void;
  onAction: (action: RowAction) => void;
  onDrag?: ((steps: number) => void) | undefined;
}) {
  const dx = useRef(new Animated.Value(0)).current;
  /*
   * Swipe left to delete.
   *
   * The gesture is claimed only once it is clearly HORIZONTAL and past a few
   * pixels — a list that grabs every touch cannot be scrolled, and one that
   * grabs at one pixel fires on a tap that wobbled. Letting go short of the
   * threshold springs back, so a half-swipe is a decision not to.
   */
  const pan = useRef(
    PanResponder.create({
      // Both thresholds and both decisions are core's — see claimsSwipe.
      onMoveShouldSetPanResponder: (_e, g) => claimsSwipe(g.dx, g.dy),
      onPanResponderMove: (_e, g) => { if (g.dx < 0) dx.setValue(g.dx); },
      onPanResponderRelease: (_e, g) => {
        if (swipeDeletes(g.dx)) {
          // Off the edge first, so the row is gone before the list reflows —
          // otherwise it snaps back for a frame on its way out.
          Animated.timing(dx, { toValue: -600, duration: 140, useNativeDriver: false })
            .start(() => onAction('delete'));
        } else {
          Animated.spring(dx, { toValue: 0, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dx, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;

  return (
    <View testID="txn-row">
      {/* Sits behind the row and is revealed by the swipe, so the intent is
          visible before the finger lifts. */}
      <View style={styles.swipeBack} pointerEvents="none">
        <Text style={styles.swipeText}>Delete</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: dx }] }} {...pan.panHandlers}>
      <Pressable
        onLongPress={onOpen}
        onPress={open ? onClose : undefined}
        // Long-press is invisible, so the row says what it offers.
        accessibilityHint={onOpen === undefined ? undefined : 'Hold for actions'}
        style={[styles.row, open && styles.rowOpen]}
        testID="txn-row-body"
      >
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
          {onDrag !== undefined && (
            <>
              {/* Up and down rather than a free drag: a list this short is
                  moved a place at a time, and two buttons work identically on
                  a mouse, a finger and a screen reader. */}
              <Action label="↑" onPress={() => onDrag(-1)} testID="row-up" />
              <Action label="↓" onPress={() => onDrag(1)} testID="row-down" />
            </>
          )}
          <Action label="Edit" onPress={() => onAction('edit')} testID="row-edit" />
          <Action label="Duplicate" onPress={() => onAction('duplicate')} testID="row-duplicate" />
          <Action label="Copy" onPress={() => onAction('copy')} testID="row-copy" />
          <Action label="Delete" onPress={() => onAction('delete')} testID="row-delete" danger />
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

function Action({ label, onPress, testID, danger = false }: {
  label: string; onPress: () => void; testID: string; danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.action, danger && styles.actionDanger]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={[styles.actionText, danger && styles.actionTextDanger]}>{label}</Text>
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
    position: 'absolute', top: 8, right: 8, width: 8, height: 8,
    borderRadius: 4, backgroundColor: T.positive,
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm,
  },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xl, flexGrow: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: SPACE.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  headMain: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flex: 1, minHeight: TAP },
  chev: { color: T.dim, fontSize: 13, width: 12 },
  chevShut: { transform: [{ rotate: '-90deg' }] },
  headName: { color: T.text, fontSize: 15, fontWeight: '700', flex: 1 },
  headSum: { color: T.dim, fontSize: 14, fontVariant: ['tabular-nums'] },
  headAdd: {
    width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center',
  },
  headAddText: { color: T.accent, fontSize: 24, lineHeight: 26, fontWeight: '400' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.md, paddingVertical: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  rowOpen: { opacity: 0.55 },
  swipeBack: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: T.danger, alignItems: 'flex-end', justifyContent: 'center',
    paddingRight: SPACE.lg, borderRadius: 6,
  },
  swipeText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
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
  rowActions: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center',
    gap: SPACE.xs, paddingRight: SPACE.xs,
    backgroundColor: T.bg + 'ee',
  },
  /*
   * Compact, because six of them have to fit a phone.
   *
   * With Edit at full size the row overflowed a 375-point screen and Edit —
   * the one people reach for most — was the one pushed off the end. A control
   * that is present and unreachable is worse than one that is missing.
   */
  action: {
    minHeight: TAP, justifyContent: 'center', paddingHorizontal: SPACE.sm,
    borderRadius: 8, backgroundColor: T.card,
  },
  actionDanger: { backgroundColor: T.danger },
  actionText: { color: T.text, fontSize: 14, fontWeight: '600' },
  actionTextDanger: { color: '#ffffff' },
  rowMain: { flex: 1, gap: 2 },
  rowSide: { alignItems: 'flex-end', gap: 2 },
  name: { color: T.text, fontSize: 17 },
  desc: { color: T.dim, fontSize: 14 },
  amount: { color: T.text, fontSize: 17, fontVariant: ['tabular-nums'] },
  amountUp: { color: T.positive },
  date: { color: T.dim, fontSize: 13 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: SPACE.xs, padding: SPACE.xl },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
