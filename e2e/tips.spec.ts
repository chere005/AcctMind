/**
 * What the marks mean — Sean, 2026-09-18: "add tooltips to the icons for
 * assigned, spent, etc."
 *
 * The budget's columns are icons because the words do not fit at 56 points,
 * and the word has always been there for a screen reader. What is pinned here
 * is that it now reaches everyone else too: on a pointer by hovering, and on
 * a touch screen — which has no hover to give — by tapping.
 */
import { expect, test } from '@playwright/test';
import { monthBudget, withStore } from './helpers';

/**
 * One line with money on it, so the Assigned column has a number to name.
 *
 * The $250 is a `budgets` record for THIS MONTH, and `line.budget` is left at
 * zero deliberately. The Budget tab reads one month and nothing else since
 * Sean took the View dropdown out (2026-09-21, "always have a month
 * selected"), so `line.budget` is a number the screen never draws — a fixture
 * that put the money there would make this test green against a row reading
 * the wrong field, which is the shape of a check that cannot fail.
 *
 * A FUNCTION, not a constant: the set is `m:YYYY-MM` for today, and a worker
 * that imports the file in one month and runs the test in the next would
 * seed a month the tab is not looking at.
 */
const STORE = () => JSON.stringify({
  v: 4,
  txns: [],
  accounts: [{ id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 1, updated: 1 }],
  categories: [{ id: 'c1', name: 'Frequent', color: '#66d695', order: 0, created: 1, updated: 1 }],
  lines: [{
    id: 'l1', name: 'Groceries', category: 'c1', budget: 0, needs: 30000,
    snoozed: false, order: 0, created: 1, updated: 1,
  }],
  budgets: [monthBudget('l1', 25000)],
});

test('a column mark says which column it is, on hover and on tap', async ({ page }) => {
  await withStore(page, STORE());
  await page.getByTestId('tab-budget').click();

  const mark = page.getByTestId('col-budgeted');
  // The mark alone carries no text at all — that is the whole problem.
  await expect(mark).toHaveText('');

  // A POINTER: hovering says it, and leaving takes it away again.
  await mark.hover();
  await expect(mark).toHaveText('Assigned');
  await page.getByTestId('budget-title').hover();
  await expect(mark).toHaveText('');

  // A TOUCH SCREEN has no hover to give, so a tap has to do it. It must
  // survive the hover-out a browser raises at the end of the same tap.
  await mark.click();
  await expect(mark).toHaveText('Assigned');

  // …and the other three say their own names, not the envelope's.
  await page.getByTestId('col-spent').click();
  await expect(page.getByTestId('col-spent')).toHaveText('Spent');
  await page.getByTestId('col-available').click();
  await expect(page.getByTestId('col-available')).toHaveText('Available');
  await page.getByTestId('col-needs').click();
  await expect(page.getByTestId('col-needs')).toHaveText('Needs');
});

test('a tapped tip goes away by itself', async ({ page }) => {
  // It has no dismiss and must not need one: a bubble that sat there until
  // something else was tapped would be a bubble covering the row under it.
  await withStore(page, STORE());
  await page.getByTestId('tab-budget').click();
  const mark = page.getByTestId('col-spent');
  await mark.click();
  await expect(mark).toHaveText('Spent');
  await expect(mark).toHaveText('', { timeout: 4000 });
});

test('the round bar controls say what they are', async ({ page }) => {
  // Every one of them is a mark with no word near it, and the word was
  // already written down for a screen reader.
  await withStore(page, STORE());
  await page.getByTestId('tab-budget').click();
  const pencil = page.getByTestId('budget-edit-toggle');
  await expect(pencil).toHaveText('');
  await pencil.hover();
  await expect(pencil).toHaveText('Edit budget');
});

test('a number says which column it is under, and still opens the pad', async ({ page }) => {
  // Sean, 2026-09-18: "tooltip should appear over numbers as well." Hover
  // only for the three that open a pad — a tap there has a better answer to
  // "what is this number" than a word does, and the tip must not steal it.
  await withStore(page, STORE());
  await page.getByTestId('tab-budget').click();

  // The fixture's $250 is assigned in the month the tab opens on, which is
  // the only month it can be on — so the number is drawn without anything
  // being chosen first.
  const assigned = page.getByTestId('line-budgeted-tap-l1');
  await expect(assigned).toHaveText('$250.00');
  await assigned.hover();
  await expect(assigned).toContainText('Assigned');

  await assigned.click();
  await expect(page.getByTestId('pad-amount')).toBeVisible();
  await page.getByTestId('pad-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('pad-amount')).toBeHidden();

  // SPENT has no pad to open, so a tap there may flash its tip — and it
  // still cannot be typed over, which is what the missing tap target says.
  await expect(page.getByTestId('line-spent-tap-l1')).toHaveCount(0);
  await page.getByTestId('line-spent-l1').hover();
  await expect(page.getByTestId('line-spent-l1').locator('..')).toContainText('Spent');
});
