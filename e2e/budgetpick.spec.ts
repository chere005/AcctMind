/**
 * Picking budget lines, and the three buttons that assign to them.
 *
 * Sean, 2026-09-21: "add the same selector for budget categories.. it
 * doesn't show a sum though, next to the all and clear buttons are '= 0'
 * which sets the category to 0, '= flag icon' which adds however much to
 * assigned to reach the amount needed, or '= up arrow' which brings the
 * amount assigned to match the sum of the transactions."
 *
 * The ARITHMETIC of all three is core's — `assignedFor`, replayed from
 * `spec/budget.json`, and `assignMany` for where the answer lands. What is
 * only checkable here is the WIRING: that the flag button is wired to the
 * flag column, that a press writes THIS month rather than the line, that it
 * touches the picked lines and no others, and that the bar's own count is
 * about lines the screen is actually showing.
 */
import { expect, test, type Page } from '@playwright/test';
import { assignedIn, monthBudget, stored, withStore } from './helpers';

/** Today, as `YYYY-MM-DD`. The fixture's spending has to land in the month
 *  the tab opens on, because that is the only month it reads. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Three lines, each set up to answer a different button differently.
 *
 *   l1 Groceries — a target of $300, $50 assigned, $120 spent. All three
 *                  buttons move it, and to three different numbers.
 *   l2 Coffee    — NO target, $25 assigned, $10 spent. The flag must leave
 *                  it exactly where it is; the other two must not.
 *   l3 Rent      — a target of $1000 and $1200 assigned, nothing spent. The
 *                  flag must not take the extra $200 away.
 */
const STORE = () => JSON.stringify({
  v: 4,
  accounts: [{ id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 1, updated: 1 }],
  categories: [{ id: 'c1', name: 'Food', color: '#66d695', order: 0, created: 1, updated: 1 }],
  lines: [
    { id: 'l1', name: 'Groceries', category: 'c1', budget: 0, needs: 30000, snoozed: false, order: 0, created: 1, updated: 1 },
    { id: 'l2', name: 'Coffee', category: 'c1', budget: 0, needs: 0, snoozed: false, order: 1, created: 1, updated: 1 },
    { id: 'l3', name: 'Rent', category: 'c1', budget: 0, needs: 100000, snoozed: false, order: 2, created: 1, updated: 1 },
  ],
  txns: [
    { id: 't1', name: 'Shop', amount: -12000, date: today(), account: 'a1', category: 'l1', order: 2, created: 1, updated: 1 },
    { id: 't2', name: 'Latte', amount: -1000, date: today(), account: 'a1', category: 'l2', order: 1, created: 1, updated: 1 },
  ],
  budgets: [monthBudget('l1', 5000), monthBudget('l2', 2500), monthBudget('l3', 120000)],
});

async function onBudget(page: Page): Promise<void> {
  await withStore(page, STORE());
  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('budget-title')).toBeVisible();
}

const pick = (page: Page, id: string) => page.getByTestId(`line-pick-${id}`).click();

test('the bar is there before anything is picked, and says so', async ({ page }) => {
  // ChefMind's rule, carried over with the bar (Sean there, 2026-09-16): a
  // bar that appears only once something is picked is a count you cannot
  // read until after you have guessed at the control that produces it.
  await onBudget(page);
  await expect(page.getByTestId('budget-picked-bar')).toBeVisible();
  await expect(page.getByTestId('budget-picked-count')).toHaveText('0 selected');
});

test('the count is a COUNT — no sum, unlike the ledger', async ({ page }) => {
  // Sean, 2026-09-21: "it doesn't show a sum though." The ledger picks rows
  // in order to add them up; the budget picks them in order to assign to
  // them, and a fifth figure beside four money columns is one more number
  // to read past.
  await onBudget(page);
  await pick(page, 'l1');
  await pick(page, 'l2');
  await expect(page.getByTestId('budget-picked-count')).toHaveText('2 selected');
  await expect(page.getByTestId('budget-picked-count')).not.toContainText('$');
});

test('All picks every line, Clear puts them all back', async ({ page }) => {
  await onBudget(page);
  await page.getByTestId('budget-picked-all').click();
  await expect(page.getByTestId('budget-picked-count')).toHaveText('3 selected');
  await page.getByTestId('budget-picked-clear').click();
  await expect(page.getByTestId('budget-picked-count')).toHaveText('0 selected');
});

test('All reaches into a FOLDED category', async ({ page }) => {
  // The drag's flat list leaves a shut category's lines out, because a row
  // that renders nothing has no midpoint to drop against. A selection is a
  // different question, and `All` skipping whatever you happened to have
  // closed would be a button quietly doing something else.
  await onBudget(page);
  await page.getByTestId('category-head-c1').click();
  await expect(page.getByTestId('line-row-l1')).toBeHidden();
  await page.getByTestId('budget-picked-all').click();
  await expect(page.getByTestId('budget-picked-count')).toHaveText('3 selected');
});

test('nothing picked, nothing assigned — pressing all three changes nothing', async ({ page }) => {
  /*
   * Delete's rule, for Delete's reason: a live control that does nothing is
   * the one that gets pressed twice.
   *
   * Asserted on BEHAVIOUR rather than on the disabled attribute. A
   * react-native-web Pressable is a div, and what `disabled` becomes on one
   * is a detail of that library — a check reading it would be about
   * react-native-web, and would keep passing if the handler started firing
   * on an empty selection anyway. What must be true is that nothing moves.
   */
  await onBudget(page);
  for (const id of ['zero', 'needs', 'spent']) {
    await page.getByTestId(`budget-assign-${id}`).click({ force: true });
  }
  await expect(page.getByTestId('line-budgeted-l1')).toHaveText('$50.00');
  await expect(page.getByTestId('line-budgeted-l2')).toHaveText('$25.00');
  await expect(page.getByTestId('line-budgeted-l3')).toHaveText('$1,200.00');
  expect(await assignedIn(page, 'l1')).toBe(5000);

  // And the aria the screen reader reads says the same.
  await expect(page.getByTestId('budget-assign-zero')).toHaveAttribute('aria-disabled', 'true');
  await pick(page, 'l1');
  await expect(page.getByTestId('budget-assign-zero')).not.toHaveAttribute('aria-disabled', 'true');
});

test('= 0 empties what is picked and leaves the rest alone', async ({ page }) => {
  await onBudget(page);
  await pick(page, 'l1');
  await page.getByTestId('budget-assign-zero').click();

  await expect(page.getByTestId('line-budgeted-l1')).toHaveText('$0.00');
  expect(await assignedIn(page, 'l1')).toBe(0);
  // The other two were never picked and must not have moved.
  await expect(page.getByTestId('line-budgeted-l2')).toHaveText('$25.00');
  expect(await assignedIn(page, 'l3')).toBe(120000);
});

test('= flag ADDS up to the target, and never takes away', async ({ page }) => {
  await onBudget(page);
  await page.getByTestId('budget-picked-all').click();
  await page.getByTestId('budget-assign-needs').click();

  // Short of its $300 target: topped up to it.
  await expect(page.getByTestId('line-budgeted-l1')).toHaveText('$300.00');
  // NO target at all. Zero is not a target, and a button that wiped this
  // line would be reading "no target" as "a target of nothing".
  await expect(page.getByTestId('line-budgeted-l2')).toHaveText('$25.00');
  // Funded PAST its target. The flag adds; it does not level down.
  await expect(page.getByTestId('line-budgeted-l3')).toHaveText('$1,200.00');
});

test('= up arrow brings assigned to what actually moved', async ({ page }) => {
  await onBudget(page);
  await page.getByTestId('budget-picked-all').click();
  await page.getByTestId('budget-assign-spent').click();

  // Money out is negative in this ledger, so $120 spent is -12000 and the
  // assignment that matches it is 12000 — and the line is then exactly
  // level: nothing left, nothing over.
  await expect(page.getByTestId('line-budgeted-l1')).toHaveText('$120.00');
  await expect(page.getByTestId('line-available-l1')).toHaveText('$0.00');
  await expect(page.getByTestId('line-budgeted-l2')).toHaveText('$10.00');
  // Nothing has moved through Rent, so matching it assigns nothing.
  await expect(page.getByTestId('line-budgeted-l3')).toHaveText('$0.00');
});

test('a press writes THIS MONTH, never the line', async ({ page }) => {
  // The whole of "budget changes are unique to that view only", from the
  // bulk side. `line.budget` is the All Time number and nothing on this
  // screen has drawn it since the view dropdown went; a bulk assign that
  // wrote there would look right on screen and be invisible next month.
  await onBudget(page);
  await pick(page, 'l1');
  await page.getByTestId('budget-assign-spent').click();
  await expect(page.getByTestId('line-budgeted-l1')).toHaveText('$120.00');

  const s = await stored(page) as { lines: { id: string; budget: number }[] };
  expect(s.lines.find((l) => l.id === 'l1')?.budget).toBe(0);
  expect(await assignedIn(page, 'l1')).toBe(12000);
});

test('the bar deletes the picked lines, on the second press', async ({ page }) => {
  await onBudget(page);
  await pick(page, 'l2');
  await pick(page, 'l3');

  await page.getByTestId('budget-picked-delete').click();
  // Armed, not done. One press must not remove two lines.
  await expect(page.getByTestId('line-row-l2')).toBeVisible();
  await page.getByTestId('budget-picked-delete').click();

  await expect(page.getByTestId('line-row-l2')).toBeHidden();
  await expect(page.getByTestId('line-row-l3')).toBeHidden();
  await expect(page.getByTestId('line-row-l1')).toBeVisible();

  // A tombstone, not a removal: dropping the record would work perfectly
  // here and be undone by the next merge.
  const s = await stored(page) as { lines: { id: string; deleted?: true }[] };
  expect(s.lines.find((l) => l.id === 'l2')?.deleted).toBe(true);
  expect(s.lines.find((l) => l.id === 'l1')?.deleted).toBeUndefined();
});

test('the No Category row has no selector, because there is no record', async ({ page }) => {
  // Every other control on that row is already withheld for the same
  // reason — no rename, no delete, no grip, no snooze, no pad.
  await withStore(page, JSON.stringify({
    v: 4,
    accounts: [{ id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 1, updated: 1 }],
    categories: [{ id: 'c1', name: 'Food', color: '#66d695', order: 0, created: 1, updated: 1 }],
    lines: [{ id: 'l1', name: 'Groceries', category: 'c1', budget: 0, needs: 0, snoozed: false, order: 0, created: 1, updated: 1 }],
    txns: [{ id: 't9', name: 'Unfiled', amount: -500, date: today(), account: 'a1', category: null, order: 1, created: 1, updated: 1 }],
    budgets: [],
  }));
  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('line-row-none')).toBeVisible();
  await expect(page.getByTestId('line-pick-none')).toHaveCount(0);
  // And All still only picks the real line.
  await page.getByTestId('budget-picked-all').click();
  await expect(page.getByTestId('budget-picked-count')).toHaveText('1 selected');
});

test('the count is still READABLE with the three buttons beside it', async ({ page }) => {
  /*
   * The bar carries three more controls here than it does on the ledger, and
   * on a 393-point phone it overran: the fixed controls and their gaps came
   * to 374, the count is the one thing in the bar that shrinks, and what it
   * shrank to was `2…`.
   *
   * Pinned at TWELVE selected, the widest count a budget realistically
   * shows — every digit is tabular, so 12 and 99 are the same width. The
   * spacing that makes it fit is in two files (the bar's gap and padding,
   * the buttons' own padding), which is exactly the kind of arithmetic that
   * comes undone one file at a time.
   */
  await withStore(page, JSON.stringify({
    v: 4,
    accounts: [{ id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 1, updated: 1 }],
    categories: [{ id: 'c1', name: 'Food', color: '#66d695', order: 0, created: 1, updated: 1 }],
    lines: Array.from({ length: 12 }, (_, i) => ({
      id: `l${i}`, name: `Line ${i}`, category: 'c1', budget: 0, needs: 0,
      snoozed: false, order: i, created: 1, updated: 1,
    })),
    txns: [], budgets: [],
  }));
  await page.getByTestId('tab-budget').click();
  await page.getByTestId('budget-picked-all').click();

  const count = page.getByTestId('budget-picked-count');
  await expect(count).toHaveText('12 selected');
  // Its own width against the width it was given. NOT scrollWidth: react-
  // native-web clamps a single-line Text, so those two stay equal whether or
  // not an ellipsis is drawn — see "A check that was DELETED" in TESTING.md.
  const { drawn, wanted } = await count.evaluate((el) => {
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.style.cssText = 'position:fixed;left:-9999px;width:auto;max-width:none;white-space:pre';
    document.body.appendChild(ghost);
    const w = ghost.getBoundingClientRect().width;
    ghost.remove();
    return { drawn: el.getBoundingClientRect().width, wanted: w };
  });
  expect(drawn).toBeGreaterThanOrEqual(wanted - 0.5);
  // And nothing was pushed off the end to pay for it.
  const bar = (await page.getByTestId('budget-picked-bar').boundingBox())!;
  const del = (await page.getByTestId('budget-picked-delete').boundingBox())!;
  expect(del.x + del.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5);
});
