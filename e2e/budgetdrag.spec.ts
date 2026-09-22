/**
 * Dragging a budget line into ANOTHER CATEGORY.
 *
 * Sean, 2026-09-21: "make it possible to drag items between sections and
 * folders in budget." Until then every category owned its own drag, over its
 * own lines, so the gesture had no way to say "somewhere else" — the screen
 * now runs ONE drag over every drawn entry and core's `rowslots.ts` turns the
 * boundary it lands on into a category and a neighbour.
 *
 * WHY THIS IS AT THIS LEVEL AT ALL. The two rules underneath are unit-tested
 * (`rowslots.test.ts`, `move.test.ts`) and are where the teeth are. What no
 * unit test can say is that the screen hands them the list it actually DREW:
 * the whole class of bug here is an index that means something different to
 * the measurer and to the rule. So this drives a real finger and reads the
 * device afterwards.
 *
 * CHROMIUM ONLY — `dragGrip` needs CDP touch events, because
 * react-native-web's PanResponder ignores a synthetic mouse and a mouse
 * "drag" would pass while doing nothing at all. See `swipeRow`.
 */
import { expect, test } from '@playwright/test';
import { dragGrip, stored, withStore } from './helpers';

type Stored = { lines: { id: string; name: string; category: string; order: number; budget: number }[] };

/** Two categories, two lines each, and nothing in the third. */
const STORE = JSON.stringify({
  v: 4,
  txns: [],
  accounts: [{ id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 1, updated: 1 }],
  categories: [
    { id: 'A', name: 'Food', color: '#66d695', order: 0, created: 1, updated: 1 },
    { id: 'B', name: 'Fun', color: '#f0b429', order: 1, created: 1, updated: 1 },
    { id: 'C', name: 'Later', color: '#4c8bf0', order: 2, created: 1, updated: 1 },
  ],
  lines: [
    { id: 'a1l', name: 'Groceries', category: 'A', budget: 1000, needs: 0, snoozed: false, order: 10, created: 1, updated: 1 },
    { id: 'a2l', name: 'Coffee', category: 'A', budget: 2000, needs: 0, snoozed: false, order: 20, created: 1, updated: 1 },
    { id: 'b1l', name: 'Cinema', category: 'B', budget: 3000, needs: 0, snoozed: false, order: 10, created: 1, updated: 1 },
    { id: 'b2l', name: 'Games', category: 'B', budget: 4000, needs: 0, snoozed: false, order: 20, created: 1, updated: 1 },
  ],
  budgets: [],
});

const lineOf = async (page: import('@playwright/test').Page, id: string) =>
  ((await stored(page)) as Stored).lines.find((l) => l.id === id)!;

/** Open the Budget tab in edit mode, which is where the grips live. */
async function budgetEdit(page: import('@playwright/test').Page): Promise<void> {
  await withStore(page, STORE);
  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('budget-title')).toBeVisible();
  await page.getByTestId('budget-edit-toggle').click();
  await expect(page.getByTestId('line-grip-a1l')).toBeVisible();
}

test.describe('dragging a line between categories', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch events');

  test('a line dropped on another category JOINS it, money and all', async ({ page }) => {
    await budgetEdit(page);
    // Into the middle of Fun, between its two rows.
    await dragGrip(page, page.getByTestId('line-grip-a1l'), page.getByTestId('line-row-b1l'), -8);

    const moved = await lineOf(page, 'a1l');
    expect(moved.category, 'the line changed category').toBe('B');
    // Nothing about the money moved with it: the amounts are keyed by set and
    // LINE id, and the transactions point at the line. Only the heading it is
    // summed under has changed.
    expect(moved.name).toBe('Groceries');
    expect(moved.budget).toBe(1000);
    // …and it is drawn under its new heading, not at the end of it.
    await expect(page.getByTestId('line-name-a1l')).toBeVisible();
    expect(moved.order).toBeLessThan((await lineOf(page, 'b2l')).order);
  });

  test('dropped just under an OPEN heading it goes to the TOP of that category', async ({ page }) => {
    // The other end of the same rule: a heading has a boundary above it (the
    // end of the category before) and one below it (the top of this one).
    await budgetEdit(page);
    await dragGrip(page, page.getByTestId('line-grip-a1l'), page.getByTestId('category-head-B'), 10);

    const moved = await lineOf(page, 'a1l');
    expect(moved.category).toBe('B');
    expect(moved.order).toBeLessThan((await lineOf(page, 'b1l')).order);
  });

  test('the category it LEFT no longer holds it', async ({ page }) => {
    await budgetEdit(page);
    await dragGrip(page, page.getByTestId('line-grip-a1l'), page.getByTestId('line-row-b2l'), 8);

    const after = (await stored(page)) as Stored;
    expect(after.lines.filter((l) => l.category === 'A').map((l) => l.id)).toEqual(['a2l']);
    expect(after.lines.filter((l) => l.category === 'B').map((l) => l.id).sort())
      .toEqual(['a1l', 'b1l', 'b2l']);
  });

  test('a line dropped on a category with NOTHING in it lands there', async ({ page }) => {
    // The empty placeholder is a drop target of its own — it is the only
    // thing standing where that category's rows would be.
    await budgetEdit(page);
    await dragGrip(page, page.getByTestId('line-grip-a1l'), page.getByTestId('category-empty'));
    expect((await lineOf(page, 'a1l')).category).toBe('C');
  });

  test('a line dropped just under a SHUT heading joins that category', async ({ page }) => {
    // The case that has no rows to aim at. Before the heading was an entry
    // of its own, a folded category could not be dropped into at all.
    await budgetEdit(page);
    await page.getByTestId('budget-edit-toggle').click();
    await page.getByTestId('category-head-B').click();
    await expect(page.getByTestId('line-row-b1l')).toHaveCount(0);
    await page.getByTestId('budget-edit-toggle').click();

    await dragGrip(page, page.getByTestId('line-grip-a1l'), page.getByTestId('category-head-B'), 8);
    expect((await lineOf(page, 'a1l')).category).toBe('B');
  });

  test('a line dragged to the bottom of its OWN category stays in it', async ({ page }) => {
    // The complaint that started the rule, in one case: this boundary sits
    // above the next category's heading, and without the heading in the list
    // it read as "the top of the next one" — so a line reordered within its
    // own category silently left it.
    await budgetEdit(page);
    await dragGrip(page, page.getByTestId('line-grip-a1l'), page.getByTestId('line-row-a2l'), 8);

    const moved = await lineOf(page, 'a1l');
    expect(moved.category).toBe('A');
    expect(moved.order).toBeGreaterThan((await lineOf(page, 'a2l')).order);
  });
});
