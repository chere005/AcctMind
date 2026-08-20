/**
 * The one screen: a header that says Transactions, the running total, the
 * list, and the + that opens the form.
 */
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatAmount, formatDay, sortTxns, total, type Txn } from '@acctmind/core';
import { SPACE, T, TAP } from './theme';

type Props = {
  txns: readonly Txn[];
  onAdd: () => void;
};

export function TransactionsScreen({ txns, onAdd }: Props) {
  // Ordering is core's, not the list's — see spec/sort.json.
  const rows = sortTxns(txns);
  const sum = total(txns);

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
        <Pressable
          onPress={onAdd}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
          testID="add-button"
        >
          <Text style={styles.addText}>+</Text>
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <Row txn={item} />}
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

function Row({ txn }: { txn: Txn }) {
  return (
    <View style={styles.row} testID="txn-row">
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
    </View>
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
  list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.md, paddingVertical: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
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
