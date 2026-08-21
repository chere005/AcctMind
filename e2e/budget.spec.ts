/**
 * The budget line editor: the operator picker, and the two-way edit.
 *
 * The arithmetic itself is core's — `applyOp`, `availableOf`, `budgetFor`,
 * all replayed from `spec/budget.json`. What is only checkable here is the
 * WIRING: that `+` is wired to plus, that the available field is wired to the
 * inverse, and that the operator applies to the value as it stood when the
 * operator was chosen rather than compounding on every keystroke.
 */
import { expect, test, type Page } from '@playwright/test';
import { stored } from './helpers';

type Stored = {
  categories: { id: string; name: string; deleted?: true }[];
  lines: { id: string; name: string; category: string; budget: number; deleted?: true }[];
};

const liveLines = (s: Stored) => s.lines.filter((l) => l.deleted !== true);

/** A category with one line in it, budgeted at $250. Returns the line id. */
async function seed(page: Page): Promise<string> {
  await page.goto('./');
  await expect(page.getByTestId('budget-title')).toBeVisible();
  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await page.getByTestId('manage-add').click();
  const s = await stored(page) as Stored;
  const cat = s.categories.filter((c) => c.deleted !== true)[0]?.id ?? '';
  await page.getByTestId(`manage-name-${cat}`).fill('Groceries');
  await page.getByTestId('manage-done').click();

  await page.getByTestId(`category-add-${cat}`).click();
  await expect(page.getByTestId('line-save')).toBeVisible();
  // CLICK before fill — under the mobile project a fill on a Modal's input
  // silently does nothing otherwise. See sections.spec.ts for the full note.
  await page.getByTestId('line-name').click();
  await page.getByTestId('line-name').fill('Produce');
  await page.getByTestId('line-budget').click();
  await page.getByTestId('line-budget').fill('250');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();
  return liveLines(await stored(page) as Stored)[0]?.id ?? '';
}

/** Reopen a line by tapping its row. */
async function openLine(page: Page, id: string): Promise<void> {
  await page.getByTestId(`line-row-${id}`).click();
  await expect(page.getByTestId('line-save')).toBeVisible();
}

test('= replaces the value', async ({ page }) => {
  const line = await seed(page);
  await openLine(page, line);
  await page.getByTestId('line-budget-op-set').click();
  await page.getByTestId('line-budget').fill('80');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(8000);
});

test('+ adds to what is already there', async ({ page }) => {
  // The whole reason for the operator. "Twenty more for groceries" is the
  // actual thought; making someone read 250, add 20 in their head and type
  // 270 is asking them to do arithmetic the app is holding all the inputs for
  // — and it is the arithmetic they will get wrong.
  const line = await seed(page);
  await openLine(page, line);
  await page.getByTestId('line-budget-op-add').click();
  await page.getByTestId('line-budget').fill('20');
  await expect(page.getByTestId('line-budget-result')).toHaveText('$270.00');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(27000);
});

test('− subtracts, and can take a line below zero', async ({ page }) => {
  // Not clamped at zero: -$50 is a true statement about an over-committed
  // line, and hiding it is the one thing a budget must not do.
  const line = await seed(page);
  await openLine(page, line);
  await page.getByTestId('line-budget-op-sub').click();
  await page.getByTestId('line-budget').fill('300');
  await expect(page.getByTestId('line-budget-result')).toHaveText('-$50.00');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(-5000);
});

test('the operator works from where the value STOOD, not from each keystroke', async ({ page }) => {
  // Typing 2 then 0 under `+` must give 250 + 20, not (250 + 2) + 20. The
  // base is captured when the operator is chosen, and every keystroke
  // recomputes from THAT — otherwise the answer depends on how fast you type.
  const line = await seed(page);
  await openLine(page, line);
  await page.getByTestId('line-budget-op-add').click();
  await page.getByTestId('line-budget').pressSequentially('20', { delay: 40 });
  await expect(page.getByTestId('line-budget-result')).toHaveText('$270.00');
});

test('editing AVAILABLE moves what is budgeted, and the two agree', async ({ page }) => {
  // One stored number and two views of it. Asking for $300 available on a
  // line with nothing spent means budgeting $300; the pair can never
  // disagree, because only one of them is written down.
  const line = await seed(page);
  await openLine(page, line);
  await page.getByTestId('line-available-op-set').click();
  await page.getByTestId('line-available').fill('300');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();

  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(30000);
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$300.00');
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$300.00');
});

test('and with money already spent, the two still agree', async ({ page }) => {
  // The case the sign error hides in. $12.50 spent, ask for $300 available,
  // and the budget has to be $312.50 — not $287.50.
  const line = await seed(page);

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('-1250');
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${line}`).click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  await page.getByTestId('tab-budget').click();
  await openLine(page, line);
  await page.getByTestId('line-available-op-set').click();
  await page.getByTestId('line-available').fill('300');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();

  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(31250);
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$300.00');
});

test('spent is shown and cannot be typed over', async ({ page }) => {
  // A budget screen that let you edit the money that actually moved would be
  // a budget screen that lies.
  const line = await seed(page);
  await openLine(page, line);
  await expect(page.getByTestId('line-spent')).toBeVisible();
  // It is a label, not a field: nothing to focus and nothing to fill.
  const tag = await page.getByTestId('line-spent').evaluate((el) => el.tagName.toLowerCase());
  expect(tag).not.toBe('input');
  expect(tag).not.toBe('textarea');
});
