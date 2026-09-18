/**
 * THE BUDGET IS MONTHLY: what a month assigns, and what it leaves behind.
 *
 * Sean, 2026-09-18: "the assigned amount should be assigned by month.. funds
 * available should read as how much is in the account in the current month..
 * the current month is how much is available with the amount assigned for the
 * current month.. assignments that aren't spent by the end of the month carry
 * over."
 *
 * Three rules, and core pins the arithmetic of all three (`spec/budget.json`,
 * `assignedBefore`). What is only checkable HERE is that the screen is wired
 * to them: that stepping to the next month really does show a fresh sheet
 * rather than a copy of this one, that last month's leftover turns up in this
 * month's available, and that the two figures in the header are the
 * subtraction they claim to be.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTransaction, fresh, stored } from './helpers';

type Stored = {
  categories: { id: string; name: string; deleted?: true }[];
  lines: { id: string; name: string; category: string; deleted?: true }[];
};

const liveLines = (s: Stored) => s.lines.filter((l) => l.deleted !== true);

/** A category with one line in it. Returns the line's id. Nothing assigned. */
async function seedLine(page: Page): Promise<string> {
  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('budget-title')).toBeVisible();
  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await page.getByTestId('manage-add').click();
  const s = await stored(page) as Stored;
  const cat = s.categories.filter((c) => c.deleted !== true).slice(-1)[0]?.id ?? '';
  await page.getByTestId(`manage-name-${cat}`).fill('Groceries');
  await page.getByTestId('manage-done').click();

  await page.getByTestId(`category-add-${cat}`).click();
  return liveLines(await stored(page) as Stored)
    .filter((l) => l.category === cat).pop()?.id ?? '';
}

/** Put the screen on Month, where every rule here lives. */
async function onMonth(page: Page): Promise<void> {
  await page.getByTestId('budget-view-pick').click();
  await page.getByTestId('budget-view-month').click();
  await expect(page.getByTestId('budget-month')).toBeVisible();
}

/** Assign an amount to a line, in whatever set the screen is on. */
async function assign(page: Page, line: string, amount: string): Promise<void> {
  await page.getByTestId(`line-budgeted-tap-${line}`).click();
  await expect(page.getByTestId('pad-amount')).toBeVisible();
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill(amount);
  await page.getByTestId('pad-amount').press('Enter');
  await expect(page.getByTestId('pad-amount')).toBeHidden();
}

test('assigning in one month says nothing about the next — and the leftover carries', async ({ page }) => {
  // Both halves of the same change, and they have to be read together: the
  // point of a month starting at zero is that what it holds came from that
  // month, and the point of the carry is that starting at zero does not lose
  // the money.
  await fresh(page);
  const line = await seedLine(page);
  await onMonth(page);

  await assign(page, line, '250');
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$250.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$250.00 assigned');

  await page.getByTestId('budget-month-next').click();
  // A FRESH SHEET. It read $250.00 here until 2026-09-18, because an unset
  // month fell back to the line's own amount — which quietly claimed every
  // month in the ledger's history had been funded.
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$0.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$0.00 assigned');
  // …and the $250 nobody spent is still the line's to spend.
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$250.00');
  await expect(page.getByTestId(`category-available-${(await stored(page) as Stored)
    .lines.find((l) => l.id === line)?.category}`)).toHaveText('$250.00');
});

/** The 15th of last month, on the string. A `YYYY-MM-DD` for `pickDay`. */
function lastMonthDay(): string {
  const now = new Date();
  const m = now.getMonth();
  const y = m === 0 ? now.getFullYear() - 1 : now.getFullYear();
  return `${y}-${String((m === 0 ? 11 : m - 1) + 1).padStart(2, '0')}-15`;
}

test('Funds Available is what the accounts HOLD, less what the month assigned', async ({ page }) => {
  // The bug this pins, from Sean's own September: the month had moved
  // -$1,682.76 and the account held $484.63, and the bar drew the movement.
  // "Funds available should read as how much is in the account in the current
  // month" — so it is the balance, which is every transaction up to the end
  // of the month being looked at and not the ones that landed in it.
  await fresh(page);
  // Cents, like every amount field in this app — 100000 is $1,000.00.
  await addTransaction(page, { name: 'Payday', amount: '100000', day: lastMonthDay() });
  await addTransaction(page, { name: 'Coffee', amount: '-10000' });
  const line = await seedLine(page);
  await onMonth(page);

  // Not -$100.00, which is all this month moved.
  await expect(page.getByTestId('budget-available')).toHaveText('$900.00');
  await assign(page, line, '300');
  await expect(page.getByTestId('budget-available')).toHaveText('$600.00');
});

test('a month nothing happened in reads zero rather than the balance again', async ({ page }) => {
  // Sean, 2026-09-18, of a month that is over: "0 if there was no activity."
  // Nothing in, nothing out, nothing assigned — so there is nothing to say,
  // and repeating the balance down a run of empty months would read as news
  // every time.
  await fresh(page);
  await addTransaction(page, { name: 'Payday', amount: '100000' });
  await seedLine(page);
  await onMonth(page);
  await expect(page.getByTestId('budget-available')).toHaveText('$1,000.00');

  await page.getByTestId('budget-month-next').click();
  await expect(page.getByTestId('budget-available')).toHaveText('$0.00');
});

test('Funds Available does not narrow with the category picker', async ({ page }) => {
  // It never has — filtering the budget to Groceries cannot change how much
  // money you have — and now that ASSIGNED is the other half of that
  // subtraction, it must not narrow either, or the pair stops being true the
  // moment somebody filters.
  await fresh(page);
  // Cents, like every amount field in this app — 100000 is $1,000.00.
  await addTransaction(page, { name: 'Payday', amount: '100000' });
  const line = await seedLine(page);
  await onMonth(page);
  await assign(page, line, '300');

  const cat = (await stored(page) as Stored).lines.find((l) => l.id === line)?.category ?? '';
  await page.getByTestId('section-pick').click();
  await page.getByTestId(`section-${cat}`).click();

  await expect(page.getByTestId('budget-available')).toHaveText('$700.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$300.00 assigned');
});
