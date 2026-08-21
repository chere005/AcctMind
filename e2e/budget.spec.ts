/**
 * Changing a budget amount: the pad on the Budget page.
 *
 * Tapping either editable number opens a small card over the list rather than
 * a screen instead of it — Sean, 2026-08-21. The arithmetic itself is core's
 * — `applyOp`, `availableOf`, `budgetFor`, all replayed from
 * `spec/budget.json`. What is only checkable here is the WIRING: that `+` is
 * wired to plus, that the available field is wired to the inverse, that the
 * operator works from the value as it STOOD rather than compounding on every
 * keystroke, and that the list is still there behind the pad.
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

/** Tap one of a line's editable numbers. Opens the pad. */
async function tapAmount(page: Page, id: string, field: 'budgeted' | 'available'): Promise<void> {
  await page.getByTestId(`line-${field}-tap-${id}`).click();
  await expect(page.getByTestId('pad-amount')).toBeVisible();
}

test('the pad opens over the list, not instead of it', async ({ page }) => {
  // It was a full screen and that was the wrong weight: changing one number
  // is a two-second thought, and a screen that hides the list you were
  // reading to decide costs more than the edit does.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  // The row behind it is still there, and no full editor opened.
  await expect(page.getByTestId(`line-row-${line}`)).toBeVisible();
  await expect(page.getByTestId('line-save')).toBeHidden();
});

test('the pad defaults to +', async ({ page }) => {
  // Adjusting is the common case — "twenty more for groceries" — and setting
  // is the one worth a deliberate tap.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount').fill('20');
  // 250 + 20, without ever choosing an operator.
  await expect(page.getByTestId('pad-amount-result')).toHaveText('$270.00');
});

test('= replaces the value', async ({ page }) => {
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('80');
  await page.getByTestId('pad-done').click();
  await expect(page.getByTestId('pad-amount')).toBeHidden();
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(8000);
});

test('+ adds to what is already there', async ({ page }) => {
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-add').click();
  await page.getByTestId('pad-amount').fill('20');
  await expect(page.getByTestId('pad-amount-result')).toHaveText('$270.00');
  await page.getByTestId('pad-done').click();
  await expect(page.getByTestId('pad-amount')).toBeHidden();
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(27000);
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$270.00');
});

test('− subtracts, and can take a line below zero', async ({ page }) => {
  // Not clamped at zero: -$50 is a true statement about an over-committed
  // line, and hiding it is the one thing a budget must not do.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-sub').click();
  await page.getByTestId('pad-amount').fill('300');
  await expect(page.getByTestId('pad-amount-result')).toHaveText('-$50.00');
  await page.getByTestId('pad-done').click();
  await expect(page.getByTestId('pad-amount')).toBeHidden();
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(-5000);
});

test('the operator works from where the value STOOD, not from each keystroke', async ({ page }) => {
  // Typing 2 then 0 under `+` must give 250 + 20, not (250 + 2) + 20. The
  // base is captured when the operator is chosen, and every keystroke
  // recomputes from THAT — otherwise the answer depends on how fast you type.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-add').click();
  await page.getByTestId('pad-amount').pressSequentially('20', { delay: 40 });
  await expect(page.getByTestId('pad-amount-result')).toHaveText('$270.00');
});

test('editing AVAILABLE moves what is budgeted, and the two agree', async ({ page }) => {
  // One stored number and two views of it. Asking for $300 available on a
  // line with nothing spent means budgeting $300; the pair can never
  // disagree, because only one of them is written down.
  const line = await seed(page);
  await tapAmount(page, line, 'available');
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('300');
  await page.getByTestId('pad-done').click();
  await expect(page.getByTestId('pad-amount')).toBeHidden();

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
  await tapAmount(page, line, 'available');
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('300');
  await page.getByTestId('pad-done').click();
  await expect(page.getByTestId('pad-amount')).toBeHidden();

  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(31250);
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$300.00');
});

test('spent is shown and cannot be typed over', async ({ page }) => {
  // A budget screen that let you edit the money that actually moved would be
  // a budget screen that lies. There is no `line-spent-tap-*` at all — the
  // other two columns have one and this one deliberately does not.
  const line = await seed(page);
  await expect(page.getByTestId(`line-spent-${line}`)).toBeVisible();
  await expect(page.getByTestId(`line-budgeted-tap-${line}`)).toBeVisible();
  await expect(page.getByTestId(`line-available-tap-${line}`)).toBeVisible();
  await expect(page.getByTestId(`line-spent-tap-${line}`)).toHaveCount(0);
});

test('the backdrop cancels — nothing typed is written', async ({ page }) => {
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-add').click();
  await page.getByTestId('pad-amount').fill('999');
  await page.getByTestId('pad-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('pad-amount')).toBeHidden();
  // Untouched: the pad holds what is being typed, and only Done writes it.
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(25000);
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$250.00');
});
