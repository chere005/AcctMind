/**
 * The Budget tab: categories, the lines inside them, and three numbers each.
 *
 * A category is a HEADING and budgets nothing of its own — Sean, 2026-08-21,
 * and the + beside its name adds a line rather than a transaction. The money
 * lives on the lines, and each one shows:
 *
 *   BUDGETED   set aside. The only stored number of the three.
 *   SPENT      the sum of the transactions filed against the line.
 *   AVAILABLE  budgeted plus spent — see core/budget.ts for why plus.
 *
 * The category's own row shows those three summed over its lines, so a
 * folded category still answers the question the tab exists for.
 */
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  availableOf, formatAmount, total,
  type Category, type Line, type Txn,
} from '@acctmind/core';
import { Dot } from './Dot';
import { SectionPick } from './SectionPick';
import { BarRow, TopBar } from './TopBar';
import { SPACE, T, TAP } from './theme';

export type LinePick = { line: Line; spent: number };
/** Which of a line's two editable numbers was tapped. */
export type LineField = 'budget' | 'available';
/** Where a tapped amount sits, in window coordinates. */
export type Anchor = { x: number; y: number; w: number; h: number };

export function BudgetScreen({
  txns, categories, lines, collapsed, onCollapsed, onManage, onAddLine, onEditLine,
  onEditAmount,
}: {
  txns: readonly Txn[];
  categories: readonly Category[];
  lines: readonly Line[];
  collapsed: readonly string[];
  onCollapsed: (ids: readonly string[]) => void;
  /** Open the category manager — the only place a category is made. */
  onManage: () => void;
  /** The + beside a category: a new line inside it. */
  onAddLine: (category: string) => void;
  /** Tapping a line's NAME opens the full editor — rename, delete. */
  onEditLine: (pick: LinePick) => void;
  /**
   * Tapping either AMOUNT opens the small pad over this page.
   *
   * The cell's position on screen goes with it, so the pad can hang off the
   * row it belongs to rather than being parked at the top away from the
   * number it is changing.
   */
  onEditAmount: (pick: LinePick, field: LineField, at: Anchor) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const shown = view === null ? categories : categories.filter((c) => c.id === view);
  /** What has actually moved through a line. Negative for spending. */
  const spentOn = (id: string) => total(txns.filter((t) => t.category === id));
  const linesIn = (id: string) =>
    lines.filter((l) => l.category === id).slice().sort((a, b) => a.order - b.order);

  const assigned = shown.reduce(
    (n, c) => n + linesIn(c.id).reduce((m, l) => m + l.budget, 0), 0,
  );

  const toggle = (id: string) =>
    onCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]);

  return (
    <View style={styles.fill}>
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
        <Text style={styles.total} testID="budget-assigned">
          {formatAmount(assigned)} assigned
        </Text>
      </BarRow>

      <ScrollView contentContainerStyle={styles.list} scrollEnabled={shown.length > 0}>
        {shown.length === 0 && (
          <View style={styles.empty} testID="budget-empty">
            <Text style={styles.emptyTitle}>No categories yet</Text>
            <Text style={styles.emptyBody}>Make one in Manage Categories.</Text>
          </View>
        )}

        {shown.map((c) => {
          const shut = collapsed.includes(c.id);
          const rows = linesIn(c.id);
          const budgeted = rows.reduce((n, l) => n + l.budget, 0);
          const spent = rows.reduce((n, l) => n + spentOn(l.id), 0);
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
                  {/*
                    ONE number on the heading, not three.
                    
                    It carried all three at first and the category's NAME was
                    what gave: three 68-point columns plus the + leave about
                    eighty points on a phone, so `Groceries` drew as `Groc…`.
                    Available is the number a folded category has to answer —
                    "is there any left" — and the other two are one tap away.
                  */}
                  <Money
                    style={styles.headNum}
                    cents={availableOf(budgeted, spent)}
                    testID={`category-available-${c.id}`}
                    tone
                  />
                </Pressable>
                {/* Adds a LINE, not a transaction. */}
                <Pressable
                  onPress={() => onAddLine(c.id)}
                  style={styles.headAdd}
                  accessibilityRole="button"
                  accessibilityLabel={`Add a line to ${c.name}`}
                  testID={`category-add-${c.id}`}
                >
                  <Text style={styles.headAddText}>+</Text>
                </Pressable>
              </View>

              {!shut && rows.length === 0 && (
                <Text style={styles.sectionEmpty} testID="category-empty">
                  Nothing budgeted here yet — tap + to add a line
                </Text>
              )}

              {!shut && rows.length > 0 && (
                <View style={styles.colHead}>
                  <Text style={[styles.colLabel, styles.colName]} />
                  <Text style={styles.colLabel}>Budgeted</Text>
                  <Text style={styles.colLabel}>Spent</Text>
                  <Text style={styles.colLabel}>Available</Text>
                </View>
              )}

              {!shut && rows.map((l) => {
                const spentHere = spentOn(l.id);
                const pick = { line: l, spent: spentHere };
                return (
                  <View key={l.id} style={styles.row} testID={`line-row-${l.id}`}>
                    {/* The NAME opens the whole line — rename, delete. */}
                    <Pressable
                      onPress={() => onEditLine(pick)}
                      style={styles.colName}
                      accessibilityRole="button"
                      accessibilityLabel={`${l.name}, rename or delete`}
                      testID={`line-name-${l.id}`}
                    >
                      <Text style={styles.rowName} numberOfLines={1}>
                        {l.name === '' ? 'Untitled' : l.name}
                      </Text>
                    </Pressable>
                    {/* Each editable NUMBER opens the pad on this page. Not a
                        screen: changing one number is a two-second thought,
                        and a full editor for it hides the list you were
                        reading to decide. */}
                    <AmountCell
                      onPress={(at) => onEditAmount(pick, 'budget', at)}
                      label={`Budgeted ${formatAmount(l.budget)}`}
                      testID={`line-budgeted-tap-${l.id}`}
                    >
                      <Money style={styles.rowNum} cents={l.budget} testID={`line-budgeted-${l.id}`} />
                    </AmountCell>
                    {/* Spent is not tappable. It is what actually moved. */}
                    <Money style={styles.rowNum} cents={spentHere} testID={`line-spent-${l.id}`} />
                    <AmountCell
                      onPress={(at) => onEditAmount(pick, 'available', at)}
                      label={`Available ${formatAmount(availableOf(l.budget, spentHere))}`}
                      testID={`line-available-tap-${l.id}`}
                    >
                      <Money
                        style={styles.rowNum}
                        cents={availableOf(l.budget, spentHere)}
                        testID={`line-available-${l.id}`}
                        tone
                      />
                    </AmountCell>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * An amount you can tap, which reports WHERE it is.
 *
 * `measureInWindow` rather than an onLayout offset: the row sits inside a
 * ScrollView inside a couple of Views, so a layout position is relative to
 * whichever parent asked, and the pad is placed against the window. Measuring
 * at press time also means a scrolled list gives the right answer.
 */
function AmountCell({ onPress, label, testID, children }: {
  onPress: (at: Anchor) => void;
  label: string;
  testID: string;
  children: React.ReactNode;
}) {
  const box = useRef<View>(null);
  return (
    <Pressable
      ref={box}
      onPress={() => {
        const node = box.current;
        if (node === null) { onPress({ x: 0, y: 0, w: 0, h: 0 }); return; }
        // No measurement available is not a failure: the box falls back to
        // the top of the screen, centred, which is where it used to live.
        node.measureInWindow((x, y, w, h) => onPress({ x, y, w, h }));
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}

/**
 * A money column.
 *
 * `tone` colours it: an overspent line is the one thing on this screen that
 * has to be seen without reading, and it is the only place red is used here.
 */
function Money({ cents, style, testID, tone = false }: {
  cents: number; style: object; testID: string; tone?: boolean;
}) {
  return (
    <Text
      style={[style, tone && cents < 0 && styles.over, tone && cents > 0 && styles.under]}
      numberOfLines={1}
      testID={testID}
    >
      {formatAmount(cents)}
    </Text>
  );
}

/**
 * How far a LINE sits in from the list edge, so it reads as belonging to the
 * category above it.
 *
 * The category head carries its own name in this far with furniture: the
 * chevron, the colour dot, and a gap either side. The line block had none of
 * it and sat flush at the edge — which drew every line 47pt to the LEFT of the
 * category it belongs to, further out than the chevron, reading as a list with
 * a heading floating off to the right rather than a heading with lines under
 * it. Measured, not eyeballed: category name at x=63, line name at x=16.
 *
 * DERIVED from the four values the head lays out rather than typed as 47, so
 * resizing the dot or the gap moves both together instead of silently parting.
 */
const INDENT = 20 + SPACE.sm + 11 + SPACE.sm;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  total: { color: T.dim, fontSize: 15 },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: 48, flexGrow: 1, gap: 18 },
  section: { gap: SPACE.xs },
  head: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
  },
  headMain: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flex: 1, minHeight: TAP },
  chev: { color: T.dim, fontSize: 15, width: 20, height: 20, lineHeight: 20, textAlign: 'center' },
  chevShut: { transform: [{ rotate: '-90deg' }] },
  // Gold, like every section name in the app — see theme.ts.
  headName: { color: T.gold, fontSize: 16, lineHeight: 20, fontWeight: '600', flex: 1, minWidth: 0 },
  headNum: {
    color: T.dim, fontSize: 13, lineHeight: 18, flexShrink: 0,
    textAlign: 'right', fontVariant: ['tabular-nums'],
  },
  headAdd: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  headAddText: { color: T.accent, fontSize: 22, lineHeight: 24, fontWeight: '400' },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingTop: SPACE.xs, paddingLeft: INDENT },
  colLabel: {
    color: T.faint, fontSize: 10, width: 68, textAlign: 'right',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  colName: { flex: 1, minWidth: 0, textAlign: 'left' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingLeft: INDENT,
    paddingVertical: SPACE.sm, minHeight: 36,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.lineSoft,
  },
  rowName: { color: T.text, fontSize: 15, lineHeight: 20 },
  rowNum: {
    color: T.text, fontSize: 13, lineHeight: 18, width: 68,
    textAlign: 'right', fontVariant: ['tabular-nums'],
  },
  // Overspent. The only red on this screen, because it is the only thing here
  // that has to be seen without being read.
  over: { color: T.danger },
  under: { color: T.positive },
  sectionEmpty: { color: T.faint, fontSize: 14, paddingVertical: SPACE.sm, paddingLeft: INDENT },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, padding: SPACE.xl },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
