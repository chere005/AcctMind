/**
 * The Budget tab: categories, the lines inside them, and three numbers each.
 *
 * MONTH IS THE UNIT. Sean, 2026-09-18: "the assigned amount should be
 * assigned by month... assignments that aren't spent by the end of the month
 * carry over." So in Month view a line shows what THIS month assigned, and an
 * available that is the running total of every month up to this one. See
 * core/views.ts for the storage and core/budget.ts for the arithmetic.
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
 *
 * EVERYTHING IS EDITED HERE. Sean, 2026-09-15: "get rid of the edit screen
 * for budget, everything can be edited from the screen itself." There was a
 * `LineEditor` modal that owned renaming and deleting a line; it is gone, and
 * the pencil in the top bar is what this screen has instead — the same
 * gesture the Transactions tab already uses, so the two tabs stop disagreeing
 * about what a pencil means.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  LONG_PRESS_MS, availableOf, budgetIn, carriedInto, countsFrom, dropTarget, foldLevel,
  formatAmount, lineTone, linesIn, monthOf, monthSet, slotEntries, toggleSelected, total,
  unassigned, unfiledSince,
  type AssignMode, type BudgetAmount, type Category, type Line, type LineTone, type Txn,
} from '@acctmind/core';
import { Dot } from './Dot';
import {
  CheckIcon, DollarIcon, FlagIcon, PencilIcon, XIcon,
} from './Icons';
import { PickBar } from './PickBar';
import { useRowDrag, type RowDrag } from './rowdrag';
import { SectionPick } from './SectionPick';
import { Tip, TipBubble, useTip } from './Tip';
import { BarRow, CircleBtn, TopBar } from './TopBar';
import { SPACE, T, TAP } from './theme';

export type LinePick = {
  line: Line;
  spent: number;
  /** The amount as the ACTIVE SET holds it — what the pad opens showing. */
  budgeted: number;
  /**
   * What the line brought in from earlier months, 0 outside Month.
   *
   * The pad needs it for the same reason the row does: `available` is the sum
   * of all three, so typing into it has to take all three off again or the
   * carried money gets assigned a second time.
   */
  carry: number;
  /** Which set a change belongs to. 'all' writes the line itself; anything
   *  else writes that set's own record. See core/views.ts. */
  set: string;
};
/** Which of a line's two editable numbers was tapped. */
export type LineField = 'needs' | 'budget' | 'available';
/** Where a tapped amount sits, in window coordinates. */
export type Anchor = { x: number; y: number; w: number; h: number };

/**
 * The id of the heading that is not a record.
 *
 * `category: null` transactions need somewhere to be seen, and core's note on
 * `Txn.category` says why that somewhere must not be a real category: one
 * would sync, get renamed, and be deletable out from under its own rows. So
 * it is a heading this screen draws, with no +, no grip, no rename and no
 * delete — Sean, 2026-09-15, and it is also where a deleted category's
 * transactions land.
 */
// Built rather than written as an escape: a literal NUL in the source makes
// git call this file binary, which costs every diff and every grep on it.
const NONE = `${String.fromCharCode(31)}none`;

/**
 * Keep the tap from stealing focus off the field it just opened.
 *
 * Tapping a name mounts an autoFocus TextInput — and then the SAME click
 * finishes on the body, focus leaves, `onBlur` commits, and the field closes
 * in the tick it opened. On screen that reads as the rename doing nothing at
 * all, which is what it did for the first pass of this screen and what the
 * Transactions tab's inline amount editor hit before it.
 *
 * `preventDefault` on mousedown stops the browser moving focus in the first
 * place. Web-only and harmless elsewhere: react-native-web forwards unknown
 * props to the DOM node, and native never sees a mousedown.
 */
/**
 * A month either side, on the string — no `Date` anywhere near it.
 *
 * The same rule day.ts keeps: `new Date('2026-09')` is parsed in the runtime's
 * own zone and stepping it by a month then lands wherever that zone put it.
 * Twelve months in a year is arithmetic, and this is the arithmetic.
 */
function stepMonth(month: string, by: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + by;
  const year = y + Math.floor(m / 12);
  const mon = ((m % 12) + 12) % 12;
  return `${year}-${String(mon + 1).padStart(2, '0')}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "September 2026". Built from the parts, for the reason above. */
function monthName(month: string): string {
  const mon = MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
  return `${mon} ${month.slice(0, 4)}`;
}

const KEEP_FOCUS = {
  onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
} as unknown as Record<string, unknown>;

export function BudgetScreen({
  txns, categories, lines, budgets, start, collapsed, onCollapsed, onManage, onAddLine,
  onEditAmount, onRenameLine, onRenameCategory, onDeleteLine, onSnoozeLine,
  onDeleteCategory, onMoveLine, onAssignMany,
  budgetMonth, onBudgetMonth, menu, undo,
}: {
  txns: readonly Txn[];
  categories: readonly Category[];
  lines: readonly Line[];
  budgets: readonly BudgetAmount[];
  /** The budget's first day, or null. Nothing dated before it counts against a line. */
  start: string | null;
  /**
   * `YYYY-MM`, the month this screen is on. There is no other answer.
   *
   * Sean, 2026-09-21: "get rid of the view dropdown and all time… always
   * have a month selected." The screen asked WHICH SET from 2026-09-16 to
   * today — All Time, a month, or a named what-if view — and a budget kept a
   * month at a time never has more than one answer to that question. What
   * the dropdown bought was a way to read the whole ledger at once, which is
   * what the ledger tab is; what it cost was a screen whose every figure
   * meant something different depending on a control above it.
   */
  budgetMonth: string;
  /** The cog and its menu — App builds it once for both screens. */
  menu?: ReactNode;
  /**
   * The Undo button, LEFT of the pencil — Sean, 2026-09-21.
   *
   * A node, for the same reason `menu` is one: what it undoes is the
   * LEDGER, not this screen, and only App holds the store it takes back.
   * Threading the history through here so the screen could assemble the
   * same button twice is how two Undos end up disagreeing about whether
   * there is anything to undo.
   */
  undo?: ReactNode;
  onBudgetMonth: (month: string) => void;
  collapsed: readonly string[];
  onCollapsed: (ids: readonly string[]) => void;
  /** Open the category manager — where a category is MADE and coloured. */
  onManage: () => void;
  /** The + beside a category: a new line inside it. */
  onAddLine: (category: string) => void;
  /**
   * Tapping either AMOUNT opens the small pad over this page.
   *
   * The cell's position on screen goes with it, so the pad can hang off the
   * row it belongs to rather than being parked at the top away from the
   * number it is changing.
   */
  onEditAmount: (pick: LinePick, field: LineField, at: Anchor) => void;
  /** Edit mode only: a name typed in place, committed on blur or Return. */
  onRenameLine: (line: Line, name: string) => void;
  onRenameCategory: (category: Category, name: string) => void;
  /** Edit mode only, and both are armed by a first press — see `DoubleTap`. */
  onDeleteLine: (line: Line) => void;
  /** The checkbox beside a line: stop it asking for money, or start again. */
  onSnoozeLine: (line: Line, next: boolean) => void;
  /** Tombstones the category AND its lines, and un-files its transactions. */
  onDeleteCategory: (category: Category) => void;
  /**
   * A line dropped somewhere: which category it joins, and the line it lands
   * ABOVE (`null` for the end of that category).
   *
   * It took `(line, siblings, to)` until 2026-09-21 — an index into ONE
   * category's own list, which is the shape of a drag that could never leave
   * it. Sean: "make it possible to drag items between sections and folders in
   * budget." A destination and a neighbour is the pair that can say both.
   */
  onMoveLine: (line: Line, category: string, beforeId: string | null) => void;
  /**
   * Assign to every picked line at once — the bar's three buttons.
   *
   * The screen hands down WHAT each line holds and what has moved through
   * it, because only the screen knows which set is being read; core's
   * `assignedFor` decides what the mode makes of that, and `assignMany`
   * writes it. Nothing about the arithmetic is here.
   */
  onAssignMany: (
    picks: readonly { line: Line; budgeted: number; spent: number }[],
    mode: AssignMode,
  ) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<string | null>(null);
  /**
   * Edit mode, and the same rule as the Transactions tab: the pencil turns it
   * on, and every row shows its controls at once rather than one row at a
   * time. Leaving it clears what edit mode was holding — a rename half-typed
   * into a field nobody can see any more is not a change anyone asked for.
   */
  const [edit, setEdit] = useState(false);
  /** The name being typed in place, if any. One at a time, held here. */
  const [naming, setNaming] = useState<string | null>(null);
  /** Is a row mid-drag anywhere? Only the ScrollView needs to know. */
  const [dragging, setDragging] = useState(false);
  /**
   * The lines picked out — the ledger's selection, on this tab (Sean,
   * 2026-09-21: "add the same selector for budget categories").
   *
   * LINES, not categories, and the three buttons are why: Needs, Assigned
   * and Spent are columns a LINE has. A heading shows their sums, so
   * "assign this heading what it needs" is a sentence about the rows under
   * it either way — and picking the rows says which ones, where picking the
   * heading could only ever mean all of them.
   *
   * Not tied to edit mode, exactly as the ledger's is not: the dot is drawn
   * at all times, so there is never a selection you cannot see.
   */
  const [picked, setPicked] = useState<readonly string[]>([]);

  const leaveEdit = () => { setEdit(false); setNaming(null); };

  /**
   * WHICH SET, and which transactions. One answer to both: the month.
   *
   * This read a `budgetView` pref until 2026-09-21 and could be All Time,
   * the month, or a named what-if view. Sean: "get rid of the view dropdown
   * and all time… always have a month selected." So the set is derived from
   * the stepper and nothing else, and the transactions are the ones that
   * LANDED in that month (Sean, 2026-09-16: "narrowing to a month limits the
   * budget to that month and all transactions that land in that month are
   * the ones included").
   *
   * The other two sets still EXIST in core — `ALL_TIME` is where a line's
   * own `budget` field lives and `viewSet` still keys what any named view
   * was given. Nothing was tombstoned: this screen stopped offering a way
   * in, which is a change to one control rather than to anybody's data.
   */
  const set = monthSet(budgetMonth);
  /* This month's rows, from the budget's first day on — nothing dated
     before the start counts against a line (core's `countsFrom`). */
  const inScope = useMemo(
    () => countsFrom(txns.filter((t) => monthOf(t.date) === budgetMonth), start),
    [txns, budgetMonth, start],
  );
  /** What this line is budgeted IN THIS SET — never `line.budget` directly. */
  const budgetOf = (l: Line) => budgetIn({ budgets }, set, l);

  /**
   * WHAT EACH LINE CARRIES IN — assigned in an earlier month and still there.
   *
   * Sean, 2026-09-18: "assignments that aren't spent by the end of the month
   * carry over." A line's available in September is therefore everything
   * assigned to it in September and before, plus everything it has ever
   * spent; this map is that history, and `availableOf` adds the month itself.
   *
   * Unconditional since 2026-09-21, and only because the screen is: it was
   * skipped on All Time and on a named view, neither of which has a calendar
   * to carry along. `carriedInto` still refuses both for that reason.
   *
   * A MAP rather than a filter per line: the spending half has to look at
   * every transaction older than this month, and doing that once per line
   * turns the whole ledger into an N×M scan on every keystroke of a rename.
   */
  const carried = useMemo(
    () => carriedInto({ budgets }, budgetMonth, lines, txns, start),
    [txns, lines, budgets, budgetMonth, start],
  );
  const carryOf = (l: Line) => carried.get(l.id) ?? 0;

  const shown = view === null ? categories : categories.filter((c) => c.id === view);
  /** What has actually moved through a line. Negative for spending. */
  const spentOn = (id: string) => total(inScope.filter((t) => t.category === id));
  /** This budget's lines under one category, in the order they are drawn. */
  const linesOf = (id: string) => linesIn(lines, id);

  /**
   * ASSIGNED — every live line's amount in this set, over the WHOLE budget.
   *
   * It narrowed with the category picker until 2026-09-18 and must not any
   * more: Funds Available is now this figure taken off the month's money, and
   * a pair where one half narrows and the other does not is a subtraction
   * that stops being true the moment somebody filters. Neither header figure
   * answers a question about the filter — that is what the category headings
   * below are for.
   */
  const assigned = categories.reduce(
    (n, c) => n + linesOf(c.id).reduce((m, l) => m + budgetOf(l), 0), 0,
  );
  /**
   * WHAT THE ACCOUNTS HOLD at the end of the month being looked at.
   *
   * Every transaction dated up to and including it — not the ones that landed
   * IN it. Sean, 2026-09-18: "funds available should read as how much is in
   * the account in the current month", and his September had $484.63 in it
   * against a month that had moved -$1,682.76. The month's own movement is
   * what a month SPENT, which is a different question and one the columns
   * below already answer; what is in the account is everything that ever
   * happened to it, which is the balance.
   *
   * Stepping back a month therefore shows what was in the account THEN, which
   * is the only reading of "how much is in the account" a past month has.
   */
  const held = useMemo(
    () => total(txns.filter((t) => monthOf(t.date) <= budgetMonth)),
    [txns, budgetMonth],
  );
  /**
   * AVAILABLE — what the accounts hold, less what is still sitting in lines.
   *
   * Sean, 2026-09-18: "change Funds Available to Account, assigned to
   * Assigned, and to the right of that put available - assigned with label
   * Available". Then 2026-09-25: "some of that assigned money has already
   * been counted for from a spent transaction with that category" — spending
   * is already out of `held`, so only what each line has LEFT comes off, not
   * what was assigned to it. That rule is core's `unassigned`.
   *
   * `shown` is deliberately not consulted, and `txns` is every live
   * transaction. Filtering the budget to Groceries cannot change how much
   * money you have.
   */
  const available = unassigned(held, categories.flatMap((c) => linesOf(c.id).map((l) => ({
    carry: carryOf(l), budget: budgetOf(l), spent: spentOn(l.id),
  }))));

  /** Money that belongs to no line at all. Drawn under its own heading. */
  /**
   * The rows still WAITING for a category — unfiled, and after the line the
   * account's latest reconcile draws (core's `unfiledSince`; Sean,
   * 2026-09-18: after a reconcile he is "starting budgeting and tracking
   * transactions that need to be assigned after the reconcile"). Within the
   * set being looked at, like every other spend on this screen.
   */
  const waiting = useMemo(() => new Set(unfiledSince(txns).map((t) => t.id)), [txns]);
  const loose = inScope.filter((t) => waiting.has(t.id));
  const showNone = view === null && loose.length > 0;
  /**
   * The one line under the heading that is not a record — Sean, same day:
   * "no category should have a line titled No Category which can't be
   * deleted." It is drawn with the same row every real line uses, holding
   * nothing but what has been spent, so the four columns read the same way
   * here as everywhere else; it just cannot be renamed, dated, snoozed,
   * dragged or deleted, because there is no record to do any of that to.
   */
  const noneLine: Line = {
    id: 'none', name: 'No Category', category: NONE, budget: 0, needs: 0, snoozed: false,
    order: 0, created: 0, updated: 0,
  };

  const toggle = (id: string) =>
    onCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]);
  /**
   * Hold a category's caret, fold or unfold EVERY category — the gesture that
   * replaced the collapse-all button across the test suite (Sean,
   * 2026-09-16). `wasOpen` is the state of the caret that was HELD: hold an
   * open one and the budget closes, hold a closed one and it opens.
   *
   * `shown`, not every category, plus the No-category heading when it is
   * drawn: folding a heading that is filtered out of view would leave a
   * surprise waiting behind the next pick.
   */
  const foldAllCategories = (wasOpen: boolean) =>
    onCollapsed(foldLevel([...shown.map((c) => c.id), ...(showNone ? [NONE] : [])], wasOpen));

  /**
   * EVERY DRAWN ENTRY, in one flat list — the shape a cross-category drag
   * needs and the shape the drag had never had.
   *
   * Sean, 2026-09-21: "make it possible to drag items between sections and
   * folders in budget." Each category owned its own `useRowDrag` until
   * today, over its own lines, so "somewhere else" was not a place the
   * gesture could express. One hook over one list is what makes it one.
   *
   * The two rules that make the arithmetic right are core's `rowslots.ts`,
   * byte-identical with CoreMind canon and with the copies CalMind, ChefMind
   * and MyCalMind carry — it is the same bug, already paid for there on
   * 2026-09-19 ("dragging was buggy … when sections were closed and between
   * sections generally"):
   *
   *   1. The list is exactly what is DRAWN. A folded category contributes
   *      its heading and NONE of its lines, because rowdrag measures what is
   *      registered and an entry that renders nothing has no midpoint.
   *   2. A heading is an entry of its own, which is the only thing that
   *      makes "the end of this category" a place a line can be dropped
   *      rather than a boundary that spans the heading and always meant the
   *      next category down. It also gives a FOLDED category something it
   *      never had: drop a line just under a shut heading and it joins it.
   *
   * `No category` is deliberately NOT in here. It is not a record — see
   * NONE — so nothing may be filed into it, and it is drawn last, after
   * every entry this list holds, so leaving it out costs no index.
   */
  type FlatEntry =
    | { kind: 'row'; rec: Line; sectionId: string }
    | { kind: 'head' | 'empty'; sectionId: string };
  const flatRows = useMemo(() => {
    const out: FlatEntry[] = [];
    for (const c of shown) {
      out.push({ kind: 'head', sectionId: c.id });
      if (collapsed.includes(c.id)) continue;
      const rows = linesIn(lines, c.id);
      if (rows.length === 0) out.push({ kind: 'empty', sectionId: c.id });
      for (const l of rows) out.push({ kind: 'row', rec: l, sectionId: c.id });
    }
    return out;
  }, [shown, collapsed, lines]);

  const drag = useRowDrag(flatRows.length, (from, to) => {
    const src = flatRows[from];
    if (src?.kind !== 'row') return;
    const target = dropTarget(slotEntries(flatRows), from, to);
    if (target === null) return;
    onMoveLine(src.rec, target.sectionId, target.beforeId);
  });
  useEffect(() => { setDragging(drag.dragIdx !== null); }, [drag.dragIdx]);

  const flatIdxOf = (id: string) => flatRows.findIndex((x) => x.kind === 'row' && x.rec.id === id);
  const headIdxOf = (id: string) => flatRows.findIndex((x) => x.kind === 'head' && x.sectionId === id);
  const emptyIdxOf = (id: string) => flatRows.findIndex((x) => x.kind === 'empty' && x.sectionId === id);
  /**
   * A grip is offered when there is anywhere for the line to GO.
   *
   * One line in one category had none before and still has none. One line in
   * each of two categories now does, which is the whole feature: the test
   * used to be "does this category hold more than one line", and that is the
   * question a per-category drag asked.
   */
  const canDrag = edit
    && (flatRows.filter((x) => x.kind === 'row').length > 1 || shown.length > 1);

  /**
   * WHAT `All` PICKS: every line drawn right now, folded ones included.
   *
   * `flatRows` leaves a shut category's lines out — it is the DRAG's list,
   * and a row that renders nothing has no midpoint to drop against. A
   * selection is a different question: folding a category away is not a
   * statement about what you meant to select, and `All` skipping the four
   * categories you happened to have closed would be a button that quietly
   * did something else.
   */
  const visible = shown.flatMap((c) => linesOf(c.id).map((l) => l.id));

  /**
   * The three buttons, resolved against the LINES rather than against what
   * is drawn.
   *
   * A picked line can be filtered out from under the selection by the
   * category picker, and an id can name a line another device deleted.
   * Both are skipped rather than counted — core's rule for a selection that
   * outlives its rows (`selectedTotal`) — so the press does what it can and
   * says nothing about what it could not.
   */
  const pickedLines = () => picked
    .map((id) => lines.find((l) => l.id === id))
    .filter((l): l is Line => l !== undefined);
  const assignPicked = (mode: AssignMode) => onAssignMany(
    pickedLines().map((l) => ({ line: l, budgeted: budgetOf(l), spent: spentOn(l.id) })),
    mode,
  );

  return (
    <View style={styles.fill}>
      <TopBar
        title="Budget"
        titleTestID="budget-title"
        controls={
          <>
          {undo}
          <CircleBtn
            on={edit}
            onPress={() => (edit ? leaveEdit() : setEdit(true))}
            label={edit ? 'Done editing' : 'Edit budget'}
            testID="budget-edit-toggle"
          >
            <PencilIcon color={edit ? '#ffffff' : T.text} />
          </CircleBtn>
          </>
        }
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
        menu={menu}
      />

      {/* THE NUMBERS FIRST, then the controls that decide them — Sean,
          2026-09-21. It was the other way round from 2026-09-16, on the
          reading that you pick a budget before you read it; in use the
          opposite is true, because the figures are what the tab is OPENED
          for and the view and the month are changed occasionally. */}
      <BarRow>
        <View style={styles.totals}>
          {/* AVAILABLE, ASSIGNED, ACCOUNT — Sean, 2026-09-21, reversing the
              2026-09-18 order. The arithmetic still reads left to right, as
              available = account − assigned did, but the ANSWER now comes
              first: the one figure that decides whether there is money to
              spend is the one your eye lands on. Amount-then-label on all
              three, so they read as one row rather than three kinds of
              thing. */}
          {/* ONE COLOURED NUMBER, and only this one. Account carried a tone
              too until today, so two of the three went red together on a
              short month and neither stood out — a colour that appears on
              everything says nothing. Available is the figure that is
              actually good or bad news; the other two are just facts. */}
          <Text style={styles.total} testID="budget-available-line">
            <Money style={styles.total} cents={available} testID="budget-available" tone /> Available
          </Text>
          <Text style={styles.total} testID="budget-assigned">
            {formatAmount(assigned)} Assigned
          </Text>
          <Text style={styles.total} testID="budget-account-line">
            <Money style={styles.total} cents={held} testID="budget-account" /> Account
          </Text>
        </View>
      </BarRow>

      {/* THE MONTH, and nothing beside it.
          
          It shared this row with a `View:` dropdown from 2026-09-16 until
          2026-09-21, when Sean took the dropdown out: "always have a month
          selected." What is left is the one control that was ever pressed —
          arrows either side, because stepping to the month before or after
          is almost always what is wanted and a picker makes that two taps
          and a decision. */}
      <BarRow>
        <View style={styles.monthRow}>
          <Pressable
            onPress={() => onBudgetMonth(stepMonth(budgetMonth, -1))}
            style={styles.monthArrow}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            testID="budget-month-prev"
          >
            <Text style={styles.monthArrowText}>‹</Text>
          </Pressable>
          <Text style={styles.monthName} testID="budget-month">{monthName(budgetMonth)}</Text>
          <Pressable
            onPress={() => onBudgetMonth(stepMonth(budgetMonth, 1))}
            style={styles.monthArrow}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            testID="budget-month-next"
          >
            <Text style={styles.monthArrowText}>›</Text>
          </Pressable>
        </View>
      </BarRow>

      <ScrollView
        contentContainerStyle={styles.list}
        scrollEnabled={shown.length > 0 && !dragging}
      >
        {shown.length === 0 && !showNone && (
          <View style={styles.empty} testID="budget-empty">
            <Text style={styles.emptyTitle}>No categories yet</Text>
            <Text style={styles.emptyBody}>Make one in Manage Categories.</Text>
          </View>
        )}

        {shown.map((c) => (
          <CategorySection
            key={c.id}
            category={c}
            rows={linesOf(c.id)}
            shut={collapsed.includes(c.id)}
            onToggle={() => toggle(c.id)}
            onFoldAll={foldAllCategories}
            onAdd={() => onAddLine(c.id)}
            edit={edit}
            naming={naming}
            setNaming={setNaming}
            spentOn={spentOn}
            budgetOf={budgetOf}
            carryOf={carryOf}
            set={set}
            onEditAmount={onEditAmount}
            onRenameLine={onRenameLine}
            onRenameCategory={onRenameCategory}
            onDeleteLine={onDeleteLine}
            onSnoozeLine={onSnoozeLine}
            onDeleteCategory={onDeleteCategory}
            picked={picked}
            onPick={(id) => setPicked((ids) => toggleSelected(ids, id))}
            drag={drag}
            canDrag={canDrag}
            headIdx={headIdxOf(c.id)}
            emptyIdx={emptyIdxOf(c.id)}
            flatIdxOf={flatIdxOf}
          />
        ))}

        {/* The boundary BELOW everything — one past the last entry, so it
            belongs to the list rather than to whichever category happens to
            be drawn last. Every other boundary is drawn by the entry that
            sits under it. */}
        {drag.slot === flatRows.length && (
          <View style={styles.dropLine} testID="budget-drop-line" />
        )}

        {/*
          The one heading that is not a record.

          Drawn last, because it is where things END UP rather than somewhere
          anyone files to on purpose: a transaction with no category yet, or
          one whose category was deleted out from under it. It carries the
          SPENT total and nothing else — there is no budgeted figure for money
          nobody has assigned, and an `available` computed from a budget of
          zero would just restate the same number a second time.
        */}
        {showNone && (
          <View testID="category-section-none" style={styles.section}>
            <View style={styles.head}>
              <Pressable
                onPress={() => toggle(NONE)}
                onLongPress={() => foldAllCategories(!collapsed.includes(NONE))}
                delayLongPress={LONG_PRESS_MS}
                style={styles.headMain}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed.includes(NONE) }}
                accessibilityHint="Hold to fold or unfold every category"
                testID="category-head-none"
              >
                <Text style={[styles.chev, collapsed.includes(NONE) && styles.chevShut]}>⌄</Text>
                <Dot colors={[T.faint]} size={11} />
                <Text style={styles.headName} numberOfLines={1}>No category</Text>
                <Money style={styles.headNum} cents={total(loose)} testID="category-none-total" tone />
              </Pressable>
            </View>
            {!collapsed.includes(NONE) && (
              <>
                <View style={styles.colHead}>
                  <Tip style={styles.colLabel} text="Needs"><FlagIcon /></Tip>
                  <Tip style={styles.colLabel} text="Assigned"><CheckIcon /></Tip>
                  <Tip style={styles.colLabel} text="Spent"><DollarIcon color={T.danger} /></Tip>
                  <Tip style={styles.colLabel} text="Available"><DollarIcon color={T.positive} /></Tip>
                </View>
                {/* Never in edit mode, whatever the page is doing: that is
                    what "can't be deleted" means in this row's terms — no
                    grip, no ×, no rename field ever appears on it. The
                    amounts open no pad either; there is nothing to write. */}
                <LineRow
                  line={noneLine}
                  spent={total(loose)}
                  budgeted={0}
                  carry={0}
                  set={set}
                  edit={false}
                  naming={false}
                  onName={() => {}}
                  onNamed={() => {}}
                  onEditAmount={() => {}}
                  onDelete={() => {}}
                  onSnooze={() => {}}
                  grip={undefined}
                  lifted={false}
                  dy={0}
                  fixed
                />
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/*
        THE PICK BAR, the ledger's own, at the foot and always drawn — Sean,
        2026-09-21: "add the same selector for budget categories."

        AND NO DELETE — Sean, later the same day: "remove the delete button
        from the selection bar in the budget page, but not the transactions
        page." A line already has a delete of its own, on the row, behind
        the pencil; what the bar offered was the same thing in bulk, sitting
        an inch from Clear, on a screen where the selection exists to have
        money assigned to it. The ledger keeps its Delete, which is what
        the ledger's selection is most often for.

        NO SUM, and that is his word too ("it doesn't show a sum though").
        The ledger's selection is picked in order to add it up; this one is
        picked in order to ASSIGN to it, and a fifth figure beside four
        money columns would be one more number to read past. What sits in
        `detail`'s place is the three buttons.

        `= 0`, `= ⚑`, `= $` — the flag and the green dollar are marks the
        column heads already wear, so each button says which column it is
        levelling assigned against without a word on it. `= 0` is the one
        with no column: it is the number itself.

        THE GREEN $ IS AVAILABLE'S, not Spent's red one, and it was an up
        arrow until Sean said otherwise ("= up arrow should actually just be
        = green $"). It reads right: the press sets assigned to match what
        moved, which is the same thing as taking the line's AVAILABLE to
        nothing, and available is the column a person is looking at when
        they reach for it.
      */}
      <PickBar
        prefix="budget-picked"
        count={picked.length}
        onAll={() => setPicked(visible)}
        onClear={() => setPicked([])}
        extras={(
          <>
            <AssignBtn
              onPress={() => assignPicked('zero')}
              label="Assign nothing"
              off={picked.length === 0}
              testID="budget-assign-zero"
            >
              <Text style={styles.assignZero}>0</Text>
            </AssignBtn>
            <AssignBtn
              onPress={() => assignPicked('needs')}
              label="Assign up to what is needed"
              off={picked.length === 0}
              testID="budget-assign-needs"
            >
              <FlagIcon />
            </AssignBtn>
            <AssignBtn
              onPress={() => assignPicked('spent')}
              label="Assign what was spent"
              off={picked.length === 0}
              testID="budget-assign-spent"
            >
              <DollarIcon color={T.positive} />
            </AssignBtn>
          </>
        )}
      />
    </View>
  );
}

/**
 * One of the bar's three: an `=` and the thing being levelled to.
 *
 * Drawn as All and Clear are drawn — the same pill inside the same 44pt
 * target — because it is the same kind of control at the same size, and a
 * row of buttons that agree about their shape is a row you can aim at
 * without reading. Disabled with nothing picked, for the reason Delete is:
 * a live control that does nothing is the one that gets pressed twice.
 */
function AssignBtn({ onPress, label, testID, off, children }: {
  onPress: () => void;
  label: string;
  testID: string;
  /** Nothing is picked, so there is nothing for this to assign to. */
  off: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={styles.assignHit}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      testID={testID}
    >
      <View style={[styles.assign, off && styles.assignOff]}>
        <Text style={styles.assignEq}>=</Text>
        {children}
      </View>
    </Pressable>
  );
}

/**
 * One category and its lines.
 *
 * It OWNED the drag until 2026-09-21 — one `useRowDrag` per category, over
 * that category's own lines — which is exactly why a line could not leave
 * one. The hook is the screen's now, over every drawn entry at once, and
 * what comes down here is the FLAT INDEX of each thing this section draws.
 * The component stays a component rather than a loop body because it is
 * still the only thing that knows how a category renders.
 */
function CategorySection({
  category, rows, shut, onToggle, onFoldAll, onAdd, edit, naming, setNaming,
  spentOn, budgetOf, carryOf, set,
  onEditAmount, onRenameLine, onRenameCategory, onDeleteLine, onSnoozeLine,
  onDeleteCategory, picked, onPick, drag, canDrag, headIdx, emptyIdx, flatIdxOf,
}: {
  category: Category;
  rows: readonly Line[];
  shut: boolean;
  onToggle: () => void;
  /** Fold or unfold every category; the argument is this caret's own state. */
  onFoldAll: (wasOpen: boolean) => void;
  onAdd: () => void;
  edit: boolean;
  naming: string | null;
  setNaming: (id: string | null) => void;
  spentOn: (id: string) => number;
  /** This line's amount IN THE ACTIVE SET — never `line.budget` directly. */
  budgetOf: (line: Line) => number;
  /** What this line carried in from earlier months. 0 outside Month. */
  carryOf: (line: Line) => number;
  /** Which set an amount edit lands in. Passed through to the pad. */
  set: string;
  onEditAmount: (pick: LinePick, field: LineField, at: Anchor) => void;
  onRenameLine: (line: Line, name: string) => void;
  onRenameCategory: (category: Category, name: string) => void;
  onDeleteLine: (line: Line) => void;
  onSnoozeLine: (line: Line, next: boolean) => void;
  onDeleteCategory: (category: Category) => void;
  /** The line ids picked out, screen-wide. */
  picked: readonly string[];
  onPick: (id: string) => void;
  /** The screen's one drag, over every drawn entry. */
  drag: RowDrag;
  /** Is there anywhere for a line to go? See the screen's `canDrag`. */
  canDrag: boolean;
  /** This category's heading, as an index into the screen's flat list. */
  headIdx: number;
  /** Its empty-placeholder's index, or -1 when it has lines or is shut. */
  emptyIdx: number;
  /** A line's index in that same list. */
  flatIdxOf: (id: string) => number;
}) {
  const budgeted = rows.reduce((n, l) => n + budgetOf(l), 0);
  const spent = rows.reduce((n, l) => n + spentOn(l.id), 0);
  // Summed the same way the rows are, so a folded category and its open one
  // cannot disagree about what is left in it.
  const carried = rows.reduce((n, l) => n + carryOf(l), 0);

  return (
    <View testID="category-section" style={styles.section}>
      {/* The boundary ABOVE this heading: the end of whatever is drawn over
          it. Every entry carries its own line this way, so the last one in
          the list is the only case the screen has to draw itself. */}
      {drag.slot === headIdx && <View style={styles.dropLine} testID="budget-drop-line" />}
      {/*
        THE HEADING IS A DROP TARGET, and it has to be measured to be one —
        see the screen's `flatRows`. Registered whether the category is open
        or shut, which is what lets a line be dropped into a folded one.
      */}
      <View style={styles.head} ref={drag.registerRow(headIdx)} collapsable={false}>
        {/*
          In edit mode the heading is a FIELD, not a button. Sean,
          2026-09-15: "in edit mode tapping on a section name allows renaming
          in place." Outside edit mode it folds, exactly as before — one
          gesture, two meanings, and the mode is the only thing that decides
          which, so nobody has to remember a second gesture.
        */}
        {edit && naming === category.id ? (
          <View style={styles.headMain}>
            <Text style={styles.chev}>⌄</Text>
            <Dot colors={[category.color]} size={11} />
            <NameField
              value={category.name}
              style={styles.headName}
              onDone={(next) => {
                setNaming(null);
                if (next !== category.name && next !== '') onRenameCategory(category, next);
              }}
              testID={`category-name-input-${category.id}`}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => (edit ? setNaming(category.id) : onToggle())}
            // Only outside edit mode, where a press means fold. In edit mode
            // the heading is a rename target and a hold on it must not
            // quietly close the whole budget under the field.
            onLongPress={edit ? undefined : () => onFoldAll(!shut)}
            delayLongPress={LONG_PRESS_MS}
            {...(edit ? KEEP_FOCUS : {})}
            style={styles.headMain}
            accessibilityRole="button"
            accessibilityState={edit ? undefined : { expanded: !shut }}
            accessibilityHint={edit ? undefined : 'Hold to fold or unfold every category'}
            testID={`category-head-${category.id}`}
          >
            <Text style={[styles.chev, shut && styles.chevShut]}>⌄</Text>
            <Dot colors={[category.color]} size={11} />
            <Text style={styles.headName} numberOfLines={1}>
              {category.name === '' ? 'Untitled' : category.name}
            </Text>
            {/*
              ONE number on the heading, not three.

              It carried all three at first and the category's NAME was what
              gave: three 68-point columns plus the + leave about eighty
              points on a phone, so `Groceries` drew as `Groc…`. Available is
              the number a folded category has to answer — "is there any
              left" — and the other two are one tap away.
            */}
            <Money
              style={styles.headNum}
              cents={availableOf(budgeted, spent, carried)}
              testID={`category-available-${category.id}`}
              tone
            />
          </Pressable>
        )}

        {edit ? (
          <DoubleTap
            onConfirm={() => onDeleteCategory(category)}
            label={`Delete ${category.name} and un-file its transactions`}
            testID={`category-delete-${category.id}`}
          />
        ) : (
          /* Adds a LINE, not a transaction. */
          <Pressable
            onPress={onAdd}
            style={styles.headAdd}
            accessibilityRole="button"
            accessibilityLabel={`Add a line to ${category.name}`}
            testID={`category-add-${category.id}`}
          >
            <Text style={styles.headAddText}>+</Text>
          </Pressable>
        )}
      </View>

      {!shut && rows.length === 0 && (
        <View ref={drag.registerRow(emptyIdx)} collapsable={false}>
          {/* An empty category's placeholder IS that category as far as a
              drop is concerned — it is the only thing standing where its
              rows would be. */}
          {drag.slot === emptyIdx && <View style={styles.dropLine} testID="budget-drop-line" />}
          <Text style={styles.sectionEmpty} testID="category-empty">
            Nothing budgeted here yet — tap + to add a line
          </Text>
        </View>
      )}

      {!shut && rows.length > 0 && (
        <View style={styles.colHead}>
          {/*
            MARKS, not words — see Icons.tsx. At 56 points a column
            `BUDGETED` and `AVAILABLE` broke mid-word on a phone and drew as
            `BUDGETE / D`. The accessibility label carries the word, so a
            screen reader still hears "Assigned" where an eye sees a tick.

            …and since 2026-09-18 so does a TIP: hover one on the Mac, tap one
            on a phone, and it says which column it is. The word was reaching
            everybody except the people looking straight at it.

            COLOURED, and named by Sean on 2026-09-21: "the icon for needed
            should be a yellow flag, assigned is a green check mark, spent is
            a red $, and available is a green $." Which makes the last two one
            shape in two colours — the reverse of how these four were first
            drawn, where every mark had to be a different SHAPE because
            colour was not carrying anything. It works because those two are
            the halves of one idea, what went out and what is left, and
            because the colours are this app's existing three: gold for
            asking, `positive` for money there, `danger` for money gone.

            The marks are FIXED colours over numbers that change colour —
            `lineTone` paints a row's figures yellow, red, green or grey. A
            head saying what a column IS, above numbers saying how that
            column is doing, is the distinction to keep if either moves.

            ASSIGNED, not "budgeted". It is what the bar at the top of this
            screen calls the same number and what Sean calls it; the stored
            field is `budget` and always was, and a column head is not the
            place to make anyone care about that.
          */}
          <Tip style={styles.colLabel} text="Needs" testID="col-needs">
            <FlagIcon />
          </Tip>
          <Tip style={styles.colLabel} text="Assigned" testID="col-budgeted">
            <CheckIcon />
          </Tip>
          <Tip style={styles.colLabel} text="Spent" testID="col-spent">
            <DollarIcon color={T.danger} />
          </Tip>
          <Tip style={styles.colLabel} text="Available" testID="col-available">
            <DollarIcon color={T.positive} />
          </Tip>
        </View>
      )}

      {!shut && rows.map((l) => {
        const i = flatIdxOf(l.id);
        return (
        <View key={l.id} ref={drag.registerRow(i)} collapsable={false}>
          {/* One line, at the boundary the row would land on. Nothing else
              moves while a drag is live — a list that rearranges under a
              moving finger is a list you cannot aim at. */}
          {drag.slot === i && <View style={styles.dropLine} testID="budget-drop-line" />}
          <LineRow
            line={l}
            spent={spentOn(l.id)}
            budgeted={budgetOf(l)}
            carry={carryOf(l)}
            set={set}
            edit={edit}
            picked={picked.includes(l.id)}
            onPick={() => onPick(l.id)}
            naming={naming === l.id}
            onName={() => setNaming(l.id)}
            onNamed={(next) => {
              setNaming(null);
              if (next !== l.name && next !== '') onRenameLine(l, next);
            }}
            onEditAmount={onEditAmount}
            onDelete={() => onDeleteLine(l)}
            onSnooze={(next) => onSnoozeLine(l, next)}
            grip={canDrag ? drag.gripFor(i) : undefined}
            lifted={drag.dragIdx === i}
            dy={drag.dragIdx === i ? drag.dragDy : 0}
          />
        </View>
        );
      })}
    </View>
  );
}

function LineRow({
  line, spent, budgeted, carry, set, edit, picked = false, onPick, naming, onName, onNamed,
  onEditAmount, onDelete, onSnooze, grip, lifted, dy, fixed = false,
}: {
  line: Line;
  spent: number;
  /**
   * What this line is budgeted IN THE ACTIVE SET.
   *
   * Passed in rather than read off the line, because `line.budget` is only
   * the All Time answer, which nothing draws — the MONTH has its own record
   * (core/views.ts), and that is what a row shows.
   */
  budgeted: number;
  /**
   * Assigned to this line in EARLIER months and still here — see `carried`.
   *
   * It is not drawn as a column of its own: four money columns is already
   * what forced this row onto two lines, and the place it shows is
   * AVAILABLE, which is the number it is actually part of.
   */
  carry: number;
  /** Which set the pad should write a change into. */
  set: string;
  edit: boolean;
  /** Is this line picked out? Always false on the No Category row. */
  picked?: boolean;
  onPick?: (() => void) | undefined;
  naming: boolean;
  onName: () => void;
  onNamed: (next: string) => void;
  onEditAmount: (pick: LinePick, field: LineField, at: Anchor) => void;
  onDelete: () => void;
  onSnooze: (next: boolean) => void;
  grip: object | undefined;
  lifted: boolean;
  dy: number;
  /**
   * A row with NO RECORD behind it — the No Category line. It draws the
   * same four columns, but a snooze box that snoozes nothing and amounts
   * that open a pad with nothing to write into are controls that lie, so
   * neither is drawn; the box's width stays, so the columns line up.
   */
  fixed?: boolean;
}) {
  const pick = { line, spent, budgeted, carry, set };
  // One word, from core. Four colours decided in a component is four chances
  // for the Mac and the phone to disagree about what a yellow line means.
  // The line is handed over wearing THIS SET's amount, so a month where the
  // groceries are unfunded reads red there and nowhere else.
  const tone = lineTone({ ...line, budget: budgeted }, spent, carry);
  return (
    <Animated.View
      style={[
        styles.row,
        lifted && styles.rowLifted,
        picked && styles.rowPicked,
        { transform: [{ translateY: dy }], zIndex: lifted ? 2 : 0 },
      ]}
      testID={`line-row-${line.id}`}
    >
      {/*
        TWO LINES, always — Sean, 2026-09-15.
        
        One line could not hold them. Four money columns, the snooze box and
        the grip left the NAME 52 points on a phone, which drew `New line` as
        `New li…`; widening the name truncated the numbers instead, and a
        truncated number is worse because it still looks like a number.
        Neither is a trade worth making on the screen whose whole job is
        showing what a thing is called and what it costs.
        
        Always, not below a breakpoint: a row that rearranges itself between
        the Mac and the phone is two layouts to keep right, and the second one
        is only ever seen when something has already gone wrong with it.
      */}
      <View style={styles.rowTop}>
      {/*
        THE SELECTOR, first on the line and drawn whether or not edit mode is
        on — the ledger's dot, in the ledger's shape: ROUND, where the snooze
        box below it is square. Two controls on one row that both tick need
        to be told apart at a glance, and the same pair says the same thing
        one tab over (see TransactionsScreen's `boxRound`).
        
        On the TOP line rather than beside the snooze box, because the
        numbers line has 300 of a phone's 307 points spent on four money
        columns — which is why the snooze box is absolutely positioned out
        of the flow there. There is room up here, next to the name it picks.
        
        Never on the No Category row: there is no record to select.
      */}
      {fixed || onPick === undefined ? <View style={styles.pickCol} /> : (
        <Pressable
          onPress={onPick}
          style={styles.pickCol}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: picked }}
          accessibilityLabel={picked ? `${line.name} selected` : `Select ${line.name}`}
          testID={`line-pick-${line.id}`}
        >
          <View style={[styles.box, styles.boxRound, picked && styles.boxPicked]}>
            {picked && <Text style={styles.boxTick}>✓</Text>}
          </View>
        </Pressable>
      )}
      {/*
        The grip, drawn faint and always occupying its space — hidden by
        OPACITY, not by being absent, so turning edit mode on does not slide
        every line name in the budget sideways. The Transactions tab learned
        this the same way.
      */}
      <View
        style={[styles.grip, grip === undefined && styles.gripOff]}
        pointerEvents={grip === undefined ? 'none' : 'auto'}
        accessibilityLabel="Drag to reorder"
        testID={`line-grip-${line.id}`}
        {...(grip ?? {})}
      >
        <Text style={styles.gripText}>≡</Text>
      </View>


      {naming ? (
        <NameField
          value={line.name}
          style={[styles.rowName, styles.nameFill]}
          onDone={onNamed}
          testID={`line-name-input-${line.id}`}
        />
      ) : (
        <Pressable
          onPress={edit ? onName : undefined}
          {...(edit ? KEEP_FOCUS : {})}
          style={styles.nameFill}
          accessibilityRole={edit ? 'button' : undefined}
          accessibilityLabel={edit ? `Rename ${line.name}` : undefined}
          testID={`line-name-${line.id}`}
        >
          <Text style={styles.rowName} numberOfLines={1}>
            {line.name === '' ? 'Untitled' : line.name}
          </Text>
        </Pressable>
      )}


      {edit && (
        <DoubleTap
          onConfirm={onDelete}
          label={`Delete ${line.name}`}
          testID={`line-delete-${line.id}`}
        />
      )}
      </View>

      <View style={styles.rowNums}>
      {/*
        Snooze — on the NUMBERS line, its box starting exactly under the
        first letter of the name above it (Sean, 2026-09-16: "immediately
        under the M in Milk"). It sat first on line one until then, which
        pushed the name 26pt right of every category heading and left the
        checkbox floating against nothing.

        ABSOLUTE, and that is the point: in the flow it would be 26 more
        points on a line that already spends 300 of a phone's 307 on four
        money columns, and the columns shrink first (see `colName`). A
        truncated number is the one thing this row must never draw, so the
        control that is not a number is the one taken out of the flex line.

        A checkbox rather than a menu because it is a per-line yes/no flipped
        often, and it is the one control here that changes nothing about the
        money.
      */}
      {fixed ? <View style={styles.snoozeCol} /> : (
      <Pressable
        onPress={() => onSnooze(!line.snoozed)}
        style={styles.snoozeCol}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: line.snoozed }}
        accessibilityLabel={line.snoozed ? `Wake ${line.name}` : `Snooze ${line.name}`}
        testID={`line-snooze-${line.id}`}
      >
        <View style={[styles.box, line.snoozed && styles.boxOn]}>
          {line.snoozed && <Text style={styles.boxTick}>✓</Text>}
        </View>
      </Pressable>
      )}

      {/* What the line is AIMING at. Editable like the other two. */}
      <AmountCell
        onPress={(at) => onEditAmount(pick, 'needs', at)}
        fixed={fixed}
        label={`Needs ${formatAmount(line.needs)}`}
        tip="Needs"
        testID={`line-needs-tap-${line.id}`}
      >
        <Money
          style={[styles.rowNum, toneStyle(tone)]}
          cents={line.needs}
          testID={`line-needs-${line.id}`}
        />
      </AmountCell>

      {/* Each editable NUMBER opens the pad on this page. Not a screen:
          changing one number is a two-second thought, and a full editor for
          it hides the list you were reading to decide. */}
      <AmountCell
        onPress={(at) => onEditAmount(pick, 'budget', at)}
        fixed={fixed}
        label={`Assigned ${formatAmount(budgeted)}`}
        tip="Assigned"
        testID={`line-budgeted-tap-${line.id}`}
      >
        <Money
          style={[styles.rowNum, toneStyle(tone)]}
          cents={budgeted}
          testID={`line-budgeted-${line.id}`}
        />
      </AmountCell>
      {/* Spent still cannot be TYPED OVER — it is what actually moved, and
          there is deliberately no `line-spent-tap-*` to open a pad with. It
          only carries a tip now, which is why this one may be flashed by a
          tap: there is nothing else for a tap here to mean. */}
      <Tip
        text="Spent"
        label={`Spent ${formatAmount(spent)}`}
        above
      >
        <Money style={[styles.rowNum, toneStyle(tone)]} cents={spent} testID={`line-spent-${line.id}`} />
      </Tip>
      <AmountCell
        onPress={(at) => onEditAmount(pick, 'available', at)}
        fixed={fixed}
        label={`Available ${formatAmount(availableOf(budgeted, spent, carry))}`}
        tip="Available"
        testID={`line-available-tap-${line.id}`}
      >
        <Money
          style={[styles.rowNum, toneStyle(tone)]}
          cents={availableOf(budgeted, spent, carry)}
          testID={`line-available-${line.id}`}
        />
      </AmountCell>
      </View>
    </Animated.View>
  );
}

/**
 * A delete that needs two presses, the second one meaning it.
 *
 * Sean, 2026-09-15: "a delete button appears which needs the double press to
 * confirm." Not a modal, because a modal for every line is four taps to
 * remove four lines and a dialog that gets dismissed without being read. The
 * button ARMS instead — it turns red and says so — and disarms itself after a
 * few seconds, so a press left lying around under a thumb that moved on does
 * not stay dangerous.
 *
 * The timer is cleared on unmount. Without that, a row deleted by its own
 * confirm leaves a timeout holding a setState on a component that is gone.
 */
function DoubleTap({ onConfirm, label, testID }: {
  onConfirm: () => void;
  label: string;
  testID: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  return (
    <Pressable
      onPress={() => {
        if (armed) {
          if (timer.current !== null) clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
        timer.current = setTimeout(() => setArmed(false), 4000);
      }}
      style={[styles.del, armed && styles.delArmed]}
      accessibilityRole="button"
      accessibilityLabel={armed ? `${label} — press again to confirm` : label}
      accessibilityState={{ selected: armed }}
      testID={testID}
    >
      {armed
        ? <Text style={styles.delText} testID={`${testID}-armed`}>Sure?</Text>
        : <XIcon color={T.dim} size={12} />}
    </Pressable>
  );
}

/**
 * A name, edited in place.
 *
 * The field wears the SAME type and no padding of its own, so swapping one
 * for the other changes no measurement — the row does not nudge as you touch
 * it. Blur commits and so does Return; there is no cancel, because the change
 * is one field, it is visible the moment it lands, and typing it back is how
 * it is undone. The same bargain the Transactions tab's inline editor makes.
 */
function NameField({ value, style, onDone, testID }: {
  value: string;
  style: object;
  onDone: (next: string) => void;
  testID: string;
}) {
  const [text, setText] = useState(value);
  const field = useRef<TextInput>(null);
  /*
   * The blur that arrives with the tap that OPENED this field is not a person
   * leaving it.
   *
   * Mount, autofocus, and then the same click finishes on the document and
   * takes focus away again — so `onBlur` committed and closed the editor in
   * the tick it opened, and a rename looked like a button that did nothing.
   * `preventDefault` on the opening mousedown was tried first and does not
   * stop it.
   *
   * So the first blur inside this window hands focus BACK instead of
   * committing. After it, blur means what it says. Measured at 250ms because
   * the spurious one lands in the same frame; a person cannot tap, aim
   * elsewhere and land it inside a quarter of a second.
   */
  const opened = useRef(Date.now());
  return (
    <TextInput
      ref={field}
      value={text}
      onChangeText={setText}
      onBlur={() => {
        if (Date.now() - opened.current < 250) { field.current?.focus(); return; }
        onDone(text.trim());
      }}
      onSubmitEditing={() => onDone(text.trim())}
      style={[style, styles.nameField]}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
      testID={testID}
    />
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
function AmountCell({ onPress, label, tip, testID, children, fixed = false }: {
  onPress: (at: Anchor) => void;
  label: string;
  /** Not a control: draw the number and nothing else. */
  fixed?: boolean;
  /**
   * Which column this is, for the tip — Sean, 2026-09-18: "tooltip should
   * appear over numbers as well."
   *
   * HOVER ONLY, and that is not an omission. A tap on one of these opens the
   * pad, which is a better answer to "what is this number" than a word is;
   * the mark at the head of the column is the one that flashes when tapped,
   * for the surface with no pointer to hover with.
   */
  tip: string;
  testID: string;
  children: React.ReactNode;
}) {
  const box = useRef<View>(null);
  const t = useTip();
  if (fixed) return <View accessibilityLabel={label}>{children}</View>;
  return (
    <Pressable
      ref={box}
      onHoverIn={t.hover.onHoverIn}
      onHoverOut={t.hover.onHoverOut}
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
      <TipBubble text={tip} shown={t.shown} above />
    </Pressable>
  );
}

/**
 * The colour a line's numbers carry, from core's one-word verdict.
 *
 * Gray for snoozed, red for overspent, yellow for short of its target, green
 * for funded — Sean, 2026-09-15. The mapping lives here and the DECISION
 * lives in core, which is the split that keeps two surfaces from disagreeing
 * about what a colour means.
 */
function toneStyle(tone: LineTone): object {
  return tone === 'snoozed' ? styles.toneSnoozed
    : tone === 'over' ? styles.toneOver
    : tone === 'short' ? styles.toneShort
    : styles.toneFunded;
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
 *
 * The GRIP is drawn inside that indent rather than added to it, so turning
 * edit mode on moves nothing sideways.
 */
const GRIP = 16;
/*
 * A money column, now that the numbers have a LINE OF THEIR OWN.
 *
 * Four of these plus three gaps is 300 points, which fits the 327 a 390-point
 * phone leaves after the list's margins and a line's indent — with the name
 * no longer competing for any of it. It was 52 when all seven things shared
 * one row, which is what made `$1,234.56` a risk and the name unreadable.
 */
const COL = 72;
const INDENT = 20 + SPACE.sm + 11 + SPACE.sm;
/** The selector column, the ledger's width exactly (see its `pickCol`). */
const PICK = 18;
/**
 * How far a LINE sits in — the selector, the grip, and the gap after each.
 *
 * Sean, 2026-09-16: "move the budget items and their check marks further to
 * the left, closer to vertically aligned with the caret." So a line name
 * starts where the caret's own box ends rather than at INDENT (47) under the
 * category NAME. The lines read as a column under the carets now instead of
 * under the headings' text.
 *
 * DERIVED, and that is what matters here rather than the number it comes to.
 * Both controls are drawn INSIDE the indent, so edit mode slides nothing
 * sideways — and the SNOOZE BOX is positioned at this same x, because it has
 * to sit under the first letter of the name above it (Sean, same day:
 * "immediately under the M in Milk"). Adding the selector on 2026-09-21
 * moved the name 22 points right; typing the old 20 in two places is how the
 * box would have been left behind under nothing.
 */
const LINE_INDENT = PICK + SPACE.xs + GRIP + SPACE.xs;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: T.bg },
  total: { color: T.dim, fontSize: 15 },
  // Never shrinks: its arrows are 44pt targets and its name is tabular so
  // that stepping through the year does not shuffle them. It shared this row
  // with a shrinkable view name until 2026-09-21 and has it to itself now.
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexShrink: 0 },
  monthArrow: { minWidth: TAP, minHeight: TAP, alignItems: 'center', justifyContent: 'center' },
  monthArrowText: { color: T.accent, fontSize: 22, lineHeight: 24 },
  // Tabular so stepping through the year does not shuffle the arrows about.
  monthName: {
    color: T.text, fontSize: 15, fontWeight: '600',
    minWidth: 130, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  // `flex: 1` is what makes the wrap real: a row child with no width of its
  // own grows to fit its content and overflows the bar instead of wrapping.
  // Three figures arrived on 2026-09-18 and the third drew as `Availa` on a
  // phone until this took the bar's width.
  totals: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' },
  list: { paddingHorizontal: SPACE.lg, paddingBottom: 48, flexGrow: 1, gap: 18 },
  section: { gap: SPACE.xs },
  head: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.cardEdge,
    // Matching `row`, so the heading's delete and every line's delete stand in
    // ONE column. Without it the heading had no right padding at all and its X
    // sat 4pt further out than the ones under it.
    paddingRight: SPACE.xs,
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
  colHead: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    justifyContent: 'flex-end',
    paddingTop: SPACE.xs, paddingRight: SPACE.xs, paddingLeft: INDENT,
    // Above the lines underneath, so a tip hanging off a column head is not
    // painted over by the first row it hangs across.
    zIndex: 2,
  },
  // 56, not 68. A fourth money column arrived on 2026-09-15 and four at the
  // old width plus the snooze box leave a phone about seventy points for the
  // NAME — which is how `Groceries` became `Groc…` on the category heading
  // the first time this screen grew a column.
  // A box that holds an icon at the right of its column, matching the
  // numbers below it. It was a Text with uppercase letter-spacing until the
  // labels stopped fitting.
  colLabel: { width: COL, flexShrink: 1, alignItems: 'flex-end', justifyContent: 'center' },
  /*
   * A FLOOR under the name, and columns that give way instead.
   *
   * With `minWidth: 0` the name is the only flexible thing in the row, so the
   * fourth money column (Needs, 2026-09-15) plus the snooze box took it to
   * ZERO on a 375-point phone: the rename target was in the tree, laid out,
   * and impossible to hit — which is how it failed, as a click timing out on
   * an element that "resolved" fine. The numbers shrink first now.
   */
  colName: { flex: 1, minWidth: 0, textAlign: 'left' },
  // The row is a COLUMN of two lines now, not a row of seven things.
  //
  // No padding of its own: the grip and the gap after it ARE the indent, so
  // the name lands at LINE_INDENT and edit mode still slides nothing.
  row: {
    paddingRight: SPACE.xs,
    paddingVertical: SPACE.sm, gap: 2, backgroundColor: T.bg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.lineSoft,
  },
  // Line one: the grip, the name, and (in edit mode) delete.
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 26 },
  // Line two: the four money columns, hard right so they line up with the
  // icons above them and with every other row.
  // `relative` so the snooze box can be positioned against this line rather
  // than take width from it.
  rowNums: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    justifyContent: 'flex-end', paddingLeft: GRIP, position: 'relative',
  },
  // The name now has the whole of line one to itself.
  nameFill: { flex: 1, minWidth: 0 },
  // A row riding the finger paints over its neighbours, so it has to be
  // opaque — `row` sets the background for exactly that reason.
  rowLifted: { opacity: 0.96 },
  grip: { width: GRIP, alignItems: 'center', justifyContent: 'center' },
  gripOff: { opacity: 0 },
  gripText: { color: T.faint, fontSize: 15, lineHeight: 18 },
  rowName: { color: T.text, fontSize: 15, lineHeight: 20 },
  nameField: { padding: 0, margin: 0, backgroundColor: 'transparent' },
  rowNum: {
    color: T.text, fontSize: 13, lineHeight: 18, width: COL, flexShrink: 1,
    textAlign: 'right', fontVariant: ['tabular-nums'],
  },
  /*
   * The delete, in edit mode only — 22 points, not 28, and never touching the
   * name it belongs to (Sean, 2026-09-16: "the X button should have proper
   * spacing and not be so large").
   *
   * It was the heaviest mark on the screen: a bordered 28pt circle around a
   * 15pt cross, next to 13pt numbers and a 15pt name, sitting flush against
   * whatever ended the row. The circle is what carries the weight, so the
   * circle is what came down; the cross follows it to 12 so the ring keeps
   * its breathing room rather than tightening around the glyph.
   */
  del: {
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
    marginLeft: SPACE.sm,
  },
  /*
   * ARMED IT IS A PILL, not a circle. "Sure?" is about 30 points of text and
   * the circle is 22 — a fixed width here clipped the word that is the whole
   * point of the second press. `auto` lets it grow and the padding keeps it
   * from reading as a label with a border round it.
   */
  delArmed: {
    backgroundColor: T.danger, borderColor: T.danger,
    width: 'auto', paddingHorizontal: SPACE.sm,
  },
  delText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  dropLine: { height: 2, backgroundColor: T.accent, marginLeft: LINE_INDENT },
  // The four states a line can be in — see core's `lineTone`. Gray reads as
  // "not asking", which is exactly what a snoozed line is.
  toneSnoozed: { color: T.faint },
  toneOver: { color: T.danger },
  toneShort: { color: T.gold },
  toneFunded: { color: T.positive },
  // Kept for the category heading, which has no target of its own to be
  // short of and so only ever answers "is there any left".
  over: { color: T.danger },
  under: { color: T.positive },
  // `left` is measured from this line's own left edge, and the row keeps no
  // padding of its own — so LINE_INDENT lands the BOX exactly under the first
  // letter of the name above it. flex-start, not center: it is the box's left
  // edge that has to line up, not the middle of the column it sits in.
  snoozeCol: {
    position: 'absolute', left: LINE_INDENT, top: 0, bottom: 0,
    width: 22, alignItems: 'flex-start', justifyContent: 'center',
  },
  // The selector's column — the ledger's `pickCol` width, so a line and a
  // transaction wear the same control at the same distance from the edge.
  pickCol: { width: PICK, alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 15, height: 15, borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.dim,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: T.dim, borderColor: T.dim },
  // ROUND for the selector, square for snooze — the ledger's pair and its
  // reason: two controls on one row that both tick have to be told apart
  // before they are read.
  boxRound: { borderRadius: 999 },
  // ACCENT, where snooze is grey. Snoozed is a standing fact about the line;
  // a selection is something you are doing right now, and the accent is this
  // app's one colour for that.
  boxPicked: { backgroundColor: T.accent, borderColor: T.accent },
  boxTick: { color: T.bg, fontSize: 10, lineHeight: 12 },
  // A picked line gets a tinted ground, the ledger's `rowPicked` exactly.
  rowPicked: { backgroundColor: T.card },
  // The bar's three, drawn as All and Clear are drawn: the same pill inside
  // the same 44pt target, because hitSlop is a no-op on the web and a row of
  // buttons that agree about their shape is a row you can aim at.
  assignHit: { minHeight: TAP, justifyContent: 'center', flexShrink: 0 },
  // TIGHTER than All and Clear, and that is a measurement rather than a
  // taste: three of these plus All, Clear and Delete overran a 393-point
  // phone by 49 points, and the bar's count is what gives — it gave down to
  // `2…`. 5 either side of an `=` and a 14pt mark is as small as the pair
  // reads at; the height is still TAP, which is the target.
  assign: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    borderRadius: 999, paddingHorizontal: 5, paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  // Dimmed AND disabled with nothing picked — Delete's rule, for Delete's
  // reason: a live control that does nothing is the one that gets pressed
  // twice.
  assignOff: { opacity: 0.4 },
  assignEq: { color: T.dim, fontSize: 12, fontWeight: '600' },
  // The one button whose right half is a NUMBER rather than a column's mark.
  assignZero: { color: T.dim, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sectionEmpty: { color: T.faint, fontSize: 14, paddingVertical: SPACE.sm, paddingLeft: LINE_INDENT },
  empty: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    gap: SPACE.xs, padding: SPACE.xl,
  },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
