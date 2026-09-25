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
 *
 * A MONTH IS THE ONLY THING THE TAB CAN BE ON — Sean, 2026-09-21: "get rid of
 * the view dropdown and all time.. always have a month selected." Every test
 * below opened by PICKING Month from that dropdown until today, and the last
 * one picked All Time so it could see two months at once. There is no such
 * control: the tab opens on the current month, a test that needs another one
 * STEPS to it, and an amount typed into the pad lands in that month's own
 * record (`m:YYYY-MM|<line>`) rather than on `line.budget`, which nothing
 * draws any more.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTransaction, assignedIn, fresh, setSign, stored } from './helpers';

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

/**
 * Assign an amount to a line, in the month the screen is on.
 *
 * Every call site assigns in the CURRENT month — the one the tab opens on —
 * and steps the stepper afterwards if at all, which is what lets the wait
 * below read this month's record.
 */
async function assign(page: Page, line: string, amount: string): Promise<void> {
  await page.getByTestId(`line-budgeted-tap-${line}`).click();
  await expect(page.getByTestId('pad-amount')).toBeVisible();
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill(amount);
  await page.getByTestId('pad-amount').press('Enter');
  await expect(page.getByTestId('pad-amount')).toBeHidden();
  /*
   * WAIT ON THE WRITE, not on the paint.
   *
   * The pad closing and the amount reaching the store are two steps, and
   * every caller then asserts on the DRAWN figure — so a slow commit reads
   * as "the budget refused the number", which is a different bug entirely.
   * It cost a release on 2026-09-21: this test failed inside the suite lane
   * with `$0.00` after fourteen polls, and passed five times out of five the
   * moment the machine was quiet. What was different was a device build and
   * a Gradle daemon running beside the suite.
   *
   * Polling the STORE is waiting on the thing being measured. Raising the
   * element timeout would be waiting longer for the wrong signal, which
   * TESTING.md already names as the wrong fix for exactly this shape.
   *
   * THIS MONTH'S RECORD, not "the number anywhere in the store". The wait
   * accepted `line.budget` OR any set's amount while All Time was a view a
   * test could be sitting in; with the month the only set the screen has,
   * that reading would go green on a pad writing into the wrong month —
   * which is the one thing `assignedIn` exists to catch.
   */
  const want = Math.round(Number(amount) * 100);
  await expect
    .poll(() => assignedIn(page, line), {
      message: `the ${amount} never reached this month's record`, timeout: 15_000,
    })
    .toBe(want);
}

test('assigning in one month says nothing about the next — and the leftover carries', async ({ page }) => {
  // Both halves of the same change, and they have to be read together: the
  // point of a month starting at zero is that what it holds came from that
  // month, and the point of the carry is that starting at zero does not lose
  // the money.
  await fresh(page);
  const line = await seedLine(page);
  // No view to pick first — the stepper is the whole of that row now, and it
  // is drawn from the moment the tab opens.
  await expect(page.getByTestId('budget-month')).toBeVisible();

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

  // Not -$100.00, which is all this month moved.
  await expect(page.getByTestId('budget-account')).toHaveText('$900.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$0.00 Assigned');
  await expect(page.getByTestId('budget-available')).toHaveText('$900.00');
  await assign(page, line, '300');
  await expect(page.getByTestId('budget-account')).toHaveText('$900.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$300.00 Assigned');
  await expect(page.getByTestId('budget-available')).toHaveText('$600.00');
});

test('money spent from a line is not taken off Available twice', async ({ page }) => {
  // Sean, 2026-09-25: available was account minus assigned, "but some of
  // that assigned money has already been counted for from a spent
  // transaction with that category". $300 assigned, $100 of it spent: the
  // account already dropped by the $100, so only the $200 still in the line
  // comes off — $700, not the $600 the old subtraction drew.
  await fresh(page);
  await addTransaction(page, { name: 'Payday', amount: '100000', day: lastMonthDay() });
  const line = await seedLine(page);
  await assign(page, line, '300');

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('10000');
  await setSign(page, true);
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${line}`).click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();
  await page.getByTestId('tab-budget').click();

  await expect(page.getByTestId('budget-account')).toHaveText('$900.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$300.00 Assigned');
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$200.00');
  await expect(page.getByTestId('budget-available')).toHaveText('$700.00');

  // Next month the $200 is still in the line, so it is still spoken for.
  await page.getByTestId('budget-month-next').click();
  await expect(page.getByTestId('budget-assigned')).toHaveText('$0.00 Assigned');
  await expect(page.getByTestId('budget-available')).toHaveText('$700.00');
});

test('incoming cash has a category of its own, and it lands in Available', async ({ page }) => {
  // Sean, 2026-09-25: "add a category for incoming cash". Filed as Income, a
  // paycheque stops waiting under No Category, and — being no envelope —
  // nothing of it is taken off the bar's Available.
  await fresh(page);
  await addTransaction(page, { name: 'Payday', amount: '100000' });
  const line = await seedLine(page);
  await assign(page, line, '300');
  await expect(page.getByTestId('line-row-none')).toBeVisible();

  await page.getByTestId('tab-transactions').click();
  const id = (await stored(page) as { txns: { id: string }[] }).txns[0]?.id ?? '';
  await page.getByTestId(`txn-category-tap-${id}`).click();
  await page.getByTestId('category-filter').fill('inc');
  await page.getByTestId('category-income').click();
  await expect(page.getByTestId('txn-category').first()).toHaveText('Income');
  await expect.poll(async () =>
    (await stored(page) as { txns: { category: string | null }[] }).txns[0]?.category).toBe('income');

  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('line-row-none')).toHaveCount(0);
  await expect(page.getByTestId('budget-account')).toHaveText('$1,000.00');
  await expect(page.getByTestId('budget-available')).toHaveText('$700.00');
});

test('an empty month still holds the account\'s balance', async ({ page }) => {
  // The quiet-month zero left with the rename: with the figure LABELLED as
  // the account's, an empty month showing the balance is exactly right — the
  // account holds that much in an empty month too, and nothing was assigned
  // against it.
  await fresh(page);
  await addTransaction(page, { name: 'Payday', amount: '100000' });
  await seedLine(page);
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
  await assign(page, line, '300');

  const cat = (await stored(page) as Stored).lines.find((l) => l.id === line)?.category ?? '';
  await page.getByTestId('section-pick').click();
  await page.getByTestId(`section-${cat}`).click();

  await expect(page.getByTestId('budget-available')).toHaveText('$700.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$300.00 Assigned');
});

/** The 1st of the month the tab opens on — today, or a day before it. */
function firstOfThisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * The 1st of NEXT month: always after today, and never in this month's scope.
 *
 * This was `tomorrowDay()` while All Time could show every month at once. A
 * month is the unit now, and "tomorrow" is inside the month being looked at
 * on thirty days out of thirty-one and outside it on the last — a test whose
 * scope depends on the date it runs is the coin flip TESTING.md pins the
 * timezone down to avoid. The 1st of next month is both facts on every day
 * of the year. Built from the parts, like every other date in this app: a
 * `Date` stepped over a month boundary lands wherever the runtime's zone
 * put it (see `stepMonth` in BudgetScreen).
 */
function firstOfNextMonth(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const y = d.getFullYear() + (m > 11 ? 1 : 0);
  return `${y}-${String((m % 12) + 1).padStart(2, '0')}-01`;
}

test('No Category is a line that cannot be deleted, and a reconcile draws its starting line', async ({ page }) => {
  // Sean, 2026-09-18: "no category should have a line titled No Category
  // which can't be deleted.. after doing a reconcile i am cleaning things and
  // assuming that i'm starting budgeting and tracking transactions that need
  // to be assigned after the reconcile." Two claims, one row.
  await fresh(page);
  await addTransaction(page, { name: 'Old', amount: '-5000', day: firstOfThisMonth() });
  await addTransaction(page, { name: 'Later', amount: '-2000', day: firstOfNextMonth() });

  await page.getByTestId('tab-budget').click();
  // ONE MONTH AT A TIME. This picked All Time until 2026-09-21, to have both
  // rows under the heading at once; with the dropdown gone, each row waits in
  // the month it LANDED in and the test walks to it. Unfiled money is nagged
  // for in its own month — which is the same rule the columns beside it keep.
  const row = page.getByTestId('line-row-none');
  await expect(row).toBeVisible();
  await expect(row).toContainText('No Category');
  // Nothing assigned to it, this month's row waiting, and available is the hole.
  await expect(page.getByTestId('line-spent-none')).toHaveText('-$50.00');
  await expect(page.getByTestId('line-available-none')).toHaveText('-$50.00');
  // The row dated into next month is waiting under the same heading there.
  await page.getByTestId('budget-month-next').click();
  await expect(page.getByTestId('line-spent-none')).toHaveText('-$20.00');
  await page.getByTestId('budget-month-prev').click();

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
  // THIS month has nothing waiting any more, which is two claims in one
  // absence: the row dated before the line stopped asking, and the $71.00
  // Reconcile row the hammer just wrote — unfiled, dated today, right here
  // in this month — never counted. It is an adjustment, not a purchase, so
  // a heading that appeared for it would be the budget inventing spending.
  await expect(page.getByTestId('line-row-none')).toHaveCount(0);
  await expect(page.getByTestId('category-section-none')).toHaveCount(0);
  // The row dated AFTER the line is untouched by it, and still waiting.
  await page.getByTestId('budget-month-next').click();
  await expect(page.getByTestId('line-spent-none')).toHaveText('-$20.00');
  await expect(page.getByTestId('line-available-none')).toHaveText('-$20.00');
});
