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
import { addTransaction, fresh, pickView, stored } from './helpers';

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
  await expect(page.getByTestId('budget-assigned')).toHaveText('$250.00 Assigned');

  await page.getByTestId('budget-month-next').click();
  // A FRESH SHEET. It read $250.00 here until 2026-09-18, because an unset
  // month fell back to the line's own amount — which quietly claimed every
  // month in the ledger's history had been funded.
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$0.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$0.00 Assigned');
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

test('the bar reads Available, Assigned, Account — and the first is the last less the middle', async ({ page }) => {
  // The bug this pins, from Sean's own September: the month had moved
  // -$1,682.76 and the account held $484.63, and the bar drew the movement.
  // "Funds available should read as how much is in the account in the current
  // month" — so ACCOUNT is the balance, every transaction up to the end of
  // the month being looked at and not the ones that landed in it. Then, the
  // same day: "change Funds Available to Account, assigned to Assigned, and
  // to the right of that put available - assigned with label Available".
  //
  // The ORDER reversed on 2026-09-21 — "the bar should be ordered Available,
  // Assigned, Account" — so the answer comes first and the two facts it is
  // made of follow it. The arithmetic is unchanged and so is every figure
  // below; what moved is which one the eye lands on.
  await fresh(page);
  // Cents, like every amount field in this app — 100000 is $1,000.00.
  await addTransaction(page, { name: 'Payday', amount: '100000', day: lastMonthDay() });
  await addTransaction(page, { name: 'Coffee', amount: '-10000' });
  const line = await seedLine(page);
  await onMonth(page);

  // Not -$100.00, which is all this month moved.
  await expect(page.getByTestId('budget-account')).toHaveText('$900.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$0.00 Assigned');
  await expect(page.getByTestId('budget-available')).toHaveText('$900.00');
  await assign(page, line, '300');
  await expect(page.getByTestId('budget-account')).toHaveText('$900.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$300.00 Assigned');
  await expect(page.getByTestId('budget-available')).toHaveText('$600.00');
});

test('an empty month still holds the account\'s balance', async ({ page }) => {
  // The quiet-month zero left with the rename: with the figure LABELLED as
  // the account's, an empty month showing the balance is exactly right — the
  // account holds that much in an empty month too, and nothing was assigned
  // against it.
  await fresh(page);
  await addTransaction(page, { name: 'Payday', amount: '100000' });
  await seedLine(page);
  await onMonth(page);
  await expect(page.getByTestId('budget-account')).toHaveText('$1,000.00');

  await page.getByTestId('budget-month-next').click();
  await expect(page.getByTestId('budget-account')).toHaveText('$1,000.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$0.00 Assigned');
  await expect(page.getByTestId('budget-available')).toHaveText('$1,000.00');
});

test('the bar does not narrow with the category picker', async ({ page }) => {
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
  await expect(page.getByTestId('budget-assigned')).toHaveText('$300.00 Assigned');
});

/** Tomorrow, as `YYYY-MM-DD` on the local calendar. */
function tomorrowDay(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('No Category is a line that cannot be deleted, and a reconcile draws its starting line', async ({ page }) => {
  // Sean, 2026-09-18: "no category should have a line titled No Category
  // which can't be deleted.. after doing a reconcile i am cleaning things and
  // assuming that i'm starting budgeting and tracking transactions that need
  // to be assigned after the reconcile." Two claims, one row.
  await fresh(page);
  await addTransaction(page, { name: 'Old', amount: '-5000', day: lastMonthDay() });
  await addTransaction(page, { name: 'Later', amount: '-2000', day: tomorrowDay() });

  await page.getByTestId('tab-budget').click();
  // ALL TIME: the claim is that both rows land under No Category, and one of
  // them is last month's. The tab opens on the current month now, which is
  // the view that would leave it out.
  await pickView(page, 'all');
  const row = page.getByTestId('line-row-none');
  await expect(row).toBeVisible();
  await expect(row).toContainText('No Category');
  // Nothing assigned to it, both rows waiting, and the available is the hole.
  await expect(page.getByTestId('line-spent-none')).toHaveText('-$70.00');
  await expect(page.getByTestId('line-available-none')).toHaveText('-$70.00');

  // Edit mode gives it none of the controls a real line gets.
  await page.getByTestId('budget-edit-toggle').click();
  await expect(page.getByTestId('line-delete-none')).toHaveCount(0);
  await expect(page.getByTestId('line-name-input-none')).toHaveCount(0);
  await page.getByTestId('budget-edit-toggle').click();

  // Reconcile today. Everything dated up to today is history the statement
  // has accounted for; only the row dated after it still needs a category.
  await page.getByTestId('tab-transactions').click();
  const s0 = await stored(page) as { accounts: { id: string }[] };
  const acct = s0.accounts[0]!.id;
  await page.getByTestId(`account-reconcile-${acct}`).click();
  await page.getByTestId(`account-reconcile-input-${acct}`).fill('100');
  await page.getByTestId(`account-reconcile-input-${acct}`).press('Enter');
  await expect(page.getByTestId('txn-row')).toHaveCount(3);

  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('line-spent-none')).toHaveText('-$20.00');
  // The Reconcile row is an adjustment, not a purchase: it never counts.
  await expect(page.getByTestId('line-available-none')).toHaveText('-$20.00');
});
