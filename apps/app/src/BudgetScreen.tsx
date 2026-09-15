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
 *
 * EVERYTHING IS EDITED HERE. Sean, 2026-09-15: "get rid of the edit screen
 * for budget, everything can be edited from the screen itself." There was a
 * `LineEditor` modal that owned renaming and deleting a line; it is gone, and
 * the pencil in the top bar is what this screen has instead — the same
 * gesture the Transactions tab already uses, so the two tabs stop disagreeing
 * about what a pencil means.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  availableOf, formatAmount, lineTone, total,
  type Category, type Line, type LineTone, type Txn,
} from '@acctmind/core';
import { Dot } from './Dot';
import { CoinIcon, EnvelopeIcon, FlagIcon, PencilIcon, ReceiptIcon, XIcon } from './Icons';
import { useRowDrag } from './rowdrag';
import { SectionPick } from './SectionPick';
import { BarRow, CircleBtn, TopBar } from './TopBar';
import { SPACE, T, TAP } from './theme';

export type LinePick = { line: Line; spent: number };
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
const KEEP_FOCUS = {
  onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
} as unknown as Record<string, unknown>;

export function BudgetScreen({
  txns, categories, lines, collapsed, onCollapsed, onManage, onAddLine,
  onEditAmount, onRenameLine, onRenameCategory, onDeleteLine, onSnoozeLine,
  onDeleteCategory, onMoveLine,
}: {
  txns: readonly Txn[];
  categories: readonly Category[];
  lines: readonly Line[];
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
  /** A line dragged to a new place among its siblings. */
  onMoveLine: (line: Line, siblings: readonly Line[], to: number) => void;
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

  const leaveEdit = () => { setEdit(false); setNaming(null); };

  const shown = view === null ? categories : categories.filter((c) => c.id === view);
  /** What has actually moved through a line. Negative for spending. */
  const spentOn = (id: string) => total(txns.filter((t) => t.category === id));
  const linesIn = (id: string) =>
    lines.filter((l) => l.category === id).slice().sort((a, b) => a.order - b.order);

  const assigned = shown.reduce(
    (n, c) => n + linesIn(c.id).reduce((m, l) => m + l.budget, 0), 0,
  );

  /** Money that belongs to no line at all. Drawn under its own heading. */
  const loose = txns.filter((t) => t.category === null);
  const showNone = view === null && loose.length > 0;

  const toggle = (id: string) =>
    onCollapsed(collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]);

  return (
    <View style={styles.fill}>
      <TopBar
        title="Budget"
        titleTestID="budget-title"
        controls={
          <CircleBtn
            on={edit}
            onPress={() => (edit ? leaveEdit() : setEdit(true))}
            label={edit ? 'Done editing' : 'Edit budget'}
            testID="budget-edit-toggle"
          >
            <PencilIcon color={edit ? '#ffffff' : T.text} />
          </CircleBtn>
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
      />

      <BarRow>
        <Text style={styles.total} testID="budget-assigned">
          {formatAmount(assigned)} assigned
        </Text>
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
            rows={linesIn(c.id)}
            shut={collapsed.includes(c.id)}
            onToggle={() => toggle(c.id)}
            onAdd={() => onAddLine(c.id)}
            edit={edit}
            naming={naming}
            setNaming={setNaming}
            spentOn={spentOn}
            onEditAmount={onEditAmount}
            onRenameLine={onRenameLine}
            onRenameCategory={onRenameCategory}
            onDeleteLine={onDeleteLine}
            onSnoozeLine={onSnoozeLine}
            onDeleteCategory={onDeleteCategory}
            onMoveLine={onMoveLine}
            onDragging={setDragging}
          />
        ))}

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
                style={styles.headMain}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed.includes(NONE) }}
                testID="category-head-none"
              >
                <Text style={[styles.chev, collapsed.includes(NONE) && styles.chevShut]}>⌄</Text>
                <Dot colors={[T.faint]} size={11} />
                <Text style={styles.headName} numberOfLines={1}>No category</Text>
                <Money style={styles.headNum} cents={total(loose)} testID="category-none-total" tone />
              </Pressable>
            </View>
            {!collapsed.includes(NONE) && (
              <Text style={styles.sectionEmpty} testID="category-none-count">
                {loose.length} transaction{loose.length === 1 ? '' : 's'} not filed against a line
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One category, its lines, and the drag that reorders them.
 *
 * A component rather than a loop body because it OWNS a hook: each category
 * has its own `useRowDrag`, since a line only ever moves within the category
 * it belongs to. Rendering the hook inside `map` would call a different
 * number of hooks whenever a category is added — the same shape the
 * Transactions tab uses, for the same reason.
 */
function CategorySection({
  category, rows, shut, onToggle, onAdd, edit, naming, setNaming, spentOn,
  onEditAmount, onRenameLine, onRenameCategory, onDeleteLine, onSnoozeLine,
  onDeleteCategory, onMoveLine, onDragging,
}: {
  category: Category;
  rows: readonly Line[];
  shut: boolean;
  onToggle: () => void;
  onAdd: () => void;
  edit: boolean;
  naming: string | null;
  setNaming: (id: string | null) => void;
  spentOn: (id: string) => number;
  onEditAmount: (pick: LinePick, field: LineField, at: Anchor) => void;
  onRenameLine: (line: Line, name: string) => void;
  onRenameCategory: (category: Category, name: string) => void;
  onDeleteLine: (line: Line) => void;
  onSnoozeLine: (line: Line, next: boolean) => void;
  onDeleteCategory: (category: Category) => void;
  onMoveLine: (line: Line, siblings: readonly Line[], to: number) => void;
  onDragging: (live: boolean) => void;
}) {
  const drag = useRowDrag(rows.length, (from, to) => {
    const moved = rows[from];
    if (moved !== undefined) onMoveLine(moved, rows, to);
  });

  // Reported up so the ScrollView can hold still. In an effect rather than
  // during render: telling a PARENT to set state while rendering a child is
  // the render-phase update this repo has already been bitten by once.
  useEffect(() => { onDragging(drag.dragIdx !== null); }, [drag.dragIdx, onDragging]);

  const budgeted = rows.reduce((n, l) => n + l.budget, 0);
  const spent = rows.reduce((n, l) => n + spentOn(l.id), 0);

  return (
    <View testID="category-section" style={styles.section}>
      <View style={styles.head}>
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
            {...(edit ? KEEP_FOCUS : {})}
            style={styles.headMain}
            accessibilityRole="button"
            accessibilityState={edit ? undefined : { expanded: !shut }}
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
              cents={availableOf(budgeted, spent)}
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
        <Text style={styles.sectionEmpty} testID="category-empty">
          Nothing budgeted here yet — tap + to add a line
        </Text>
      )}

      {!shut && rows.length > 0 && (
        <View style={styles.colHead}>
          {/*
            MARKS, not words — see Icons.tsx. At 56 points a column
            `BUDGETED` and `AVAILABLE` broke mid-word on a phone and drew as
            `BUDGETE / D`. The accessibility label carries the word, so a
            screen reader still hears "Budgeted" where an eye sees an
            envelope.
          */}
          <View style={styles.colLabel} accessibilityLabel="Needs" testID="col-needs">
            <FlagIcon />
          </View>
          <View style={styles.colLabel} accessibilityLabel="Budgeted" testID="col-budgeted">
            <EnvelopeIcon />
          </View>
          <View style={styles.colLabel} accessibilityLabel="Spent" testID="col-spent">
            <ReceiptIcon />
          </View>
          <View style={styles.colLabel} accessibilityLabel="Available" testID="col-available">
            <CoinIcon />
          </View>
        </View>
      )}

      {!shut && rows.map((l, i) => (
        <View key={l.id} ref={drag.registerRow(i)} collapsable={false}>
          {/* One line, at the boundary the row would land on. Nothing else
              moves while a drag is live — a list that rearranges under a
              moving finger is a list you cannot aim at. */}
          {drag.slot === i && <View style={styles.dropLine} testID="budget-drop-line" />}
          <LineRow
            line={l}
            spent={spentOn(l.id)}
            edit={edit}
            naming={naming === l.id}
            onName={() => setNaming(l.id)}
            onNamed={(next) => {
              setNaming(null);
              if (next !== l.name && next !== '') onRenameLine(l, next);
            }}
            onEditAmount={onEditAmount}
            onDelete={() => onDeleteLine(l)}
            onSnooze={(next) => onSnoozeLine(l, next)}
            grip={edit && rows.length > 1 ? drag.gripFor(i) : undefined}
            lifted={drag.dragIdx === i}
            dy={drag.dragIdx === i ? drag.dragDy : 0}
          />
        </View>
      ))}
      {!shut && drag.slot === rows.length && (
        <View style={styles.dropLine} testID="budget-drop-line" />
      )}
    </View>
  );
}

function LineRow({
  line, spent, edit, naming, onName, onNamed, onEditAmount, onDelete, onSnooze,
  grip, lifted, dy,
}: {
  line: Line;
  spent: number;
  edit: boolean;
  naming: boolean;
  onName: () => void;
  onNamed: (next: string) => void;
  onEditAmount: (pick: LinePick, field: LineField, at: Anchor) => void;
  onDelete: () => void;
  onSnooze: (next: boolean) => void;
  grip: object | undefined;
  lifted: boolean;
  dy: number;
}) {
  const pick = { line, spent };
  // One word, from core. Four colours decided in a component is four chances
  // for the Mac and the phone to disagree about what a yellow line means.
  const tone = lineTone(line, spent);
  return (
    <Animated.View
      style={[
        styles.row,
        lifted && styles.rowLifted,
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


      {/*
        Snooze, FIRST on the line and under the category name above it —
        Sean, 2026-09-15. It read as an afterthought parked at the right
        margin; at the head of the row it reads the way a checkbox does
        everywhere else, as a thing you tick about the name beside it.

        A checkbox rather than a menu because it is a per-line yes/no flipped
        often, and it is the one control here that changes nothing about the
        money.
      */}
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
      {/* What the line is AIMING at. Editable like the other two. */}
      <AmountCell
        onPress={(at) => onEditAmount(pick, 'needs', at)}
        label={`Needs ${formatAmount(line.needs)}`}
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
        label={`Budgeted ${formatAmount(line.budget)}`}
        testID={`line-budgeted-tap-${line.id}`}
      >
        <Money
          style={[styles.rowNum, toneStyle(tone)]}
          cents={line.budget}
          testID={`line-budgeted-${line.id}`}
        />
      </AmountCell>
      {/* Spent is not tappable. It is what actually moved. */}
      <Money style={[styles.rowNum, toneStyle(tone)]} cents={spent} testID={`line-spent-${line.id}`} />
      <AmountCell
        onPress={(at) => onEditAmount(pick, 'available', at)}
        label={`Available ${formatAmount(availableOf(line.budget, spent))}`}
        testID={`line-available-tap-${line.id}`}
      >
        <Money
          style={[styles.rowNum, toneStyle(tone)]}
          cents={availableOf(line.budget, spent)}
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
        : <XIcon color={T.dim} />}
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
  colHead: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    justifyContent: 'flex-end',
    paddingTop: SPACE.xs, paddingRight: SPACE.xs, paddingLeft: INDENT,
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
  row: {
    paddingLeft: INDENT - GRIP, paddingRight: SPACE.xs,
    paddingVertical: SPACE.sm, gap: 2, backgroundColor: T.bg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.lineSoft,
  },
  // Line one: the grip, the name, the snooze box and (in edit mode) delete.
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 26 },
  // Line two: the four money columns, hard right so they line up with the
  // icons above them and with every other row.
  rowNums: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE.xs,
    justifyContent: 'flex-end', paddingLeft: GRIP,
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
  del: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.cardEdge,
  },
  delArmed: { backgroundColor: T.danger, borderColor: T.danger },
  delText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  dropLine: { height: 2, backgroundColor: T.accent, marginLeft: INDENT },
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
  snoozeCol: { width: 22, alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 15, height: 15, borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: T.dim,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: T.dim, borderColor: T.dim },
  boxTick: { color: T.bg, fontSize: 10, lineHeight: 12 },
  sectionEmpty: { color: T.faint, fontSize: 14, paddingVertical: SPACE.sm, paddingLeft: INDENT },
  empty: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    gap: SPACE.xs, padding: SPACE.xl,
  },
  emptyTitle: { color: T.text, fontSize: 17 },
  emptyBody: { color: T.dim, fontSize: 15 },
});
