/**
 * The one screen: a header that says Transactions, the running total, the
 * list, and the + that opens the form.
 */
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  formatAmount, formatDay, sortTxns, total, type Account, type AmountMode, type Txn,
} from '@acctmind/core';
import { Toggle } from './Toggle';
import { SPACE, T, TAP } from './theme';

export type RowAction = 'edit' | 'duplicate' | 'copy' | 'delete';

type Props = {
  txns: readonly Txn[];
  /** Add a transaction to this account. */
  onAdd: (account: string) => void;
  /** A row was held down and an action chosen. */
  onAction?: ((action: RowAction, txn: Txn) => void) | undefined;
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
};

export function TransactionsScreen({
  txns, onAdd, onAction, onDevices, peers = 0, amountMode, onAmountMode, accounts,
}: Props) {
  // Ordering is core's, not the list's — see spec/sort.json.
  const rows = sortTxns(txns);
  const sum = total(txns);
  /** The row being held open, if any. One at a time, by construction. */
  const [openId, setOpenId] = useState<string | null>(null);

  // A row that stops existing — deleted here, or deleted on another device
  // mid-gesture — must not leave its action bar behind attached to nothing.
  if (openId !== null && !rows.some((t) => t.id === openId)) setOpenId(null);

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

      <FlatList
        data={rows}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <Row
            txn={item}
            open={openId === item.id}
            onOpen={onAction === undefined ? undefined : () => setOpenId(item.id)}
            onClose={() => setOpenId(null)}
            onAction={(a) => { setOpenId(null); onAction?.(a, item); }}
          />
        )}
        contentContainerStyle={rows.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={
          <View style={styles.empty} testID="empty-state">
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptyBody}>Tap + to add the first one.</Text>
          </View>
        }
      />
    </View>
  );
}

function Row({ txn, open, onOpen, onClose, onAction }: {
  txn: Txn;
  open: boolean;
  onOpen?: (() => void) | undefined;
  onClose: () => void;
  onAction: (action: RowAction) => void;
}) {
  return (
    <View testID="txn-row">
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

      {open && (
        <View style={styles.rowActions} testID="row-actions">
          {/*
            Right to left: delete, copy, duplicate, edit. Delete is the one
            that cannot be undone, so it sits furthest from where a thumb
            rests, and edit — the one reached for most — sits nearest.
          */}
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
  list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.md, paddingVertical: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  rowOpen: { opacity: 0.55 },
  // `rowActions`, not `actions`: the header already has one of those, and a
  // duplicate key in a StyleSheet is a typecheck error rather than a subtle
  // wrong-looking row, which is the only reason this was noticed at once.
  rowActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: SPACE.xs,
    paddingBottom: SPACE.sm,
  },
  // Drawn at TAP height, never padded up to it — hitSlop is a no-op on the web.
  action: {
    minHeight: TAP, justifyContent: 'center', paddingHorizontal: SPACE.md,
    borderRadius: 8, backgroundColor: T.card,
  },
  actionDanger: { backgroundColor: T.danger },
  actionText: { color: T.text, fontSize: 15, fontWeight: '600' },
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
