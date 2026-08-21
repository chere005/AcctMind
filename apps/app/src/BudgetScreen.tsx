/**
 * The Budget tab: categories, what each has assigned, and what has actually
 * gone through it.
 *
 * The same section shape as Transactions, deliberately — one picker, one
 * collapse, one set of colours — because they are two views of one ledger and
 * a person should not have to learn the screen twice.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  formatAmount, total, type Category, type Txn,
} from '@acctmind/core';
import { Dot } from './Dot';
import { SectionPick } from './SectionPick';
import { SPACE, T, TAP } from './theme';

export function BudgetScreen({ txns, categories, collapsed, onCollapsed, onAddCategory }: {
  txns: readonly Txn[];
  categories: readonly Category[];
  collapsed: readonly string[];
  onCollapsed: (ids: readonly string[]) => void;
  onAddCategory: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const shown = view === null ? categories : categories.filter((c) => c.id === view);
  const assigned = shown.reduce((n, c) => n + c.budget, 0);
  // What has actually moved through each category. Spent is money OUT, so it
  // is the negative half — a refund landing in a category should reduce what
  // it has used, not add to it.
  const spentIn = (id: string) => total(txns.filter((t) => t.category === id));

  const toggle = (id: string) =>
    onCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]);

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title} testID="budget-title">Budget</Text>
          <Text style={styles.total} testID="budget-assigned">{formatAmount(assigned)} assigned</Text>
        </View>
        <Pressable
          onPress={onAddCategory}
          style={styles.add}
          accessibilityRole="button"
          accessibilityLabel="Add category"
          testID="category-add"
        >
          <Text style={styles.addText}>+</Text>
        </Pressable>
      </View>

      <View style={styles.pickRow}>
        <SectionPick
          label="Categories"
          sections={categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
          value={view}
          onPick={setView}
          visible={picking}
          onOpen={() => setPicking(true)}
          onClose={() => setPicking(false)}
        />
      </View>

      {/* Scrolls only when there is something to scroll — see TransactionsScreen. */}
      <ScrollView contentContainerStyle={styles.list} scrollEnabled={shown.length > 0}>
        {shown.length === 0 && (
          <View style={styles.empty} testID="budget-empty">
            <Text style={styles.emptyTitle}>No categories yet</Text>
            <Text style={styles.emptyBody}>Tap + to make the first one.</Text>
          </View>
        )}

        {shown.map((c) => {
          const shut = collapsed.includes(c.id);
          const rows = txns.filter((t) => t.category === c.id);
          return (
            <View key={c.id} testID="category-section">
              <Pressable
                onPress={() => toggle(c.id)}
                style={styles.head}
                accessibilityRole="button"
                accessibilityState={{ expanded: !shut }}
                testID={`category-head-${c.id}`}
              >
                <Text style={[styles.chev, shut && styles.chevShut]}>⌄</Text>
                <Dot colors={[c.color]} size={12} />
                <Text style={styles.headName} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.headSum}>
                  {formatAmount(spentIn(c.id))} of {formatAmount(c.budget)}
                </Text>
              </Pressable>

              {!shut && rows.map((t) => (
                <View key={t.id} style={styles.row} testID="budget-row">
                  <Text style={styles.rowName} numberOfLines={1}>{t.name}</Text>
                  <Text style={styles.rowAmount}>{formatAmount(t.amount)}</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
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
  add: {
    width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: T.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  addText: { color: '#ffffff', fontSize: 28, lineHeight: 32, fontWeight: '300' },
  pickRow: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xl, flexGrow: 1 },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: TAP,
    marginTop: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  chev: { color: T.dim, fontSize: 13, width: 12 },
  chevShut: { transform: [{ rotate: '-90deg' }] },
  headName: { color: T.text, fontSize: 15, fontWeight: '700', flex: 1 },
  headSum: { color: T.dim, fontSize: 13, fontVariant: ['tabular-nums'] },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: SPACE.md, paddingVertical: SPACE.sm,
  },
  rowName: { color: T.text, fontSize: 15, flex: 1 },
  rowAmount: { color: T.dim, fontSize: 15, fontVariant: ['tabular-nums'] },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, padding: SPACE.xl },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
