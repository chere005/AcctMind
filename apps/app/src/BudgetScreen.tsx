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
import { BarRow, TopBar } from './TopBar';
import { SPACE, T, TAP } from './theme';

export function BudgetScreen({ txns, categories, collapsed, onCollapsed, onManage, onAdd }: {
  txns: readonly Txn[];
  categories: readonly Category[];
  collapsed: readonly string[];
  onCollapsed: (ids: readonly string[]) => void;
  /** Open the category manager — the only place a category is made. */
  onManage: () => void;
  /**
   * Add a transaction already filed under this category.
   *
   * Sean, 2026-08-21: "An add button by the category name is fine." It is the
   * same gesture Accounts has on the other tab, and it carries the one thing
   * the press already knows — pressing + beside Groceries means Groceries.
   */
  onAdd: (category: string) => void;
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
      {/* The same bar as Transactions, because they are two views of one
          ledger — see TopBar. Budget has no controls of its own yet; the
          picker sits where the picker always sits. */}
      <TopBar
        title="Budget"
        titleTestID="budget-title"
        picker={
          <SectionPick
            label="Categories"
            sections={categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
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

      <BarRow>
        <Text style={styles.total} testID="budget-assigned">{formatAmount(assigned)} assigned</Text>
      </BarRow>

      {/* Scrolls only when there is something to scroll — see TransactionsScreen. */}
      <ScrollView contentContainerStyle={styles.list} scrollEnabled={shown.length > 0}>
        {shown.length === 0 && (
          <View style={styles.empty} testID="budget-empty">
            <Text style={styles.emptyTitle}>No categories yet</Text>
            <Text style={styles.emptyBody}>Make one in Manage Categories.</Text>
          </View>
        )}

        {shown.map((c) => {
          const shut = collapsed.includes(c.id);
          const rows = txns.filter((t) => t.category === c.id);
          return (
            <View key={c.id} testID="category-section" style={styles.section}>
              <View style={styles.head}>
                <Pressable
                  onPress={() => toggle(c.id)}
                  style={styles.headMain}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !shut }}
                  testID={`category-head-${c.id}`}
                >
                  <Text style={[styles.chev, shut && styles.chevShut]}>⌄</Text>
                  <Dot colors={[c.color]} size={11} />
                  <Text style={styles.headName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.headSum}>
                    {formatAmount(spentIn(c.id))} of {formatAmount(c.budget)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onAdd(c.id)}
                  style={styles.headAdd}
                  accessibilityRole="button"
                  accessibilityLabel={`Add to ${c.name}`}
                  testID={`category-add-${c.id}`}
                >
                  <Text style={styles.headAddText}>+</Text>
                </Pressable>
              </View>

              {!shut && rows.length === 0 && (
                <Text style={styles.sectionEmpty} testID="category-empty">
                  Nothing filed here yet
                </Text>
              )}
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
  total: { color: T.dim, fontSize: 15 },
  // The same list as Transactions, to the point — one ledger, two views of
  // it, and a person should not have to learn the screen twice.
  list: { paddingHorizontal: SPACE.lg, paddingBottom: 48, flexGrow: 1, gap: 18 },
  section: { gap: SPACE.sm },
  head: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  headMain: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flex: 1, minHeight: TAP },
  chev: { color: T.dim, fontSize: 15, width: 20, height: 20, lineHeight: 20, textAlign: 'center' },
  chevShut: { transform: [{ rotate: '-90deg' }] },
  // Gold, like every section name in the app — see theme.ts.
  headName: { color: T.gold, fontSize: 16, lineHeight: 20, fontWeight: '600', flex: 1 },
  headSum: { color: T.dim, fontSize: 13, fontVariant: ['tabular-nums'] },
  headAdd: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  headAddText: { color: T.accent, fontSize: 22, lineHeight: 24, fontWeight: '400' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, paddingVertical: SPACE.sm, minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.lineSoft,
  },
  rowName: { color: T.text, fontSize: 16, lineHeight: 20, flex: 1 },
  rowAmount: { color: T.dim, fontSize: 16, lineHeight: 20, fontVariant: ['tabular-nums'] },
  // An open section with nothing in it says so. Left blank it reads as a
  // section that failed to load rather than one nothing has been filed under.
  sectionEmpty: { color: T.faint, fontSize: 14, paddingVertical: SPACE.sm },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, padding: SPACE.xl },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
