/** The one flow the app has: open the form, fill it, save it, see it. */
import { expect, test } from '@playwright/test';
import { STORE_VERSION } from '@acctmind/core';
import { addTransaction, fresh, rows, stored, storedTxns } from './helpers';

test('a new device shows the empty state and no rows', async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText('$0.00');
});

test('adding one puts it on screen and on the device', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Groceries', description: 'co-op', amount: '-84.37' });

  await expect(page.getByTestId('empty-state')).toBeHidden();
  expect(await rows(page)).toEqual([
    { name: 'Groceries', description: 'co-op', amount: '-$84.37', date: expect.any(String) },
  ]);
  await expect(page.getByTestId('total')).toHaveText('-$84.37');

  // The screen agreeing is not the same as the device agreeing.
  const store = await stored(page) as { v: number; txns: { amount: number; name: string }[] };
  // Read from core, not written down: this line said 1 for a while after
  // the store went to v2, and the suite had not been re-run to notice.
  expect(store.v).toBe(STORE_VERSION);
  expect(store.txns).toHaveLength(1);
  // Cents, as an integer. If this is ever 84.37 the whole money rule is gone.
  expect(store.txns[0]?.amount).toBe(-8437);
});

/**
 * The regression that cost a real debugging round on the first run: the
 * transaction saved correctly and the form STAYED OPEN, because `save()` was
 * being called from inside a `setPhase` updater. React treats a state update
 * raised during an updater as a render-phase update and restarts the render,
 * which threw away the `setAdding(false)` batched alongside it.
 *
 * Asserting `toBeHidden`, not absence: react-native-web leaves the closed
 * Modal in the DOM, so a presence check here would fail even when correct.
 */
test('the form closes after a save', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Coffee');
  await page.getByTestId('amount-input').fill('-4.50');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('save-button')).toBeHidden();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);
});

test('cancel adds nothing, and does not keep what was typed', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Typed but abandoned');
  await page.getByTestId('amount-input').fill('99');
  await page.getByTestId('cancel-button').click();

  await expect(page.getByTestId('save-button')).toBeHidden();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
  expect(await storedTxns(page)).toEqual([]);

  // Reopening is a blank form, not the abandoned one. The amount reads '-'
  // rather than empty because a new transaction starts NEGATIVE — almost
  // everything in a ledger is money going out. A lone sign is not an amount,
  // which the required-field test below still relies on.
  await page.getByTestId('add-button').click();
  await expect(page.getByTestId('name-input')).toHaveValue('');
  await expect(page.getByTestId('amount-input')).toHaveValue('-');
});

test('a new transaction starts negative, and the sign alone is not an amount', async ({ page }) => {
  // Sean, 2026-08-21. Starting positive means tapping − on nearly every
  // entry, and the one that gets forgotten is a payment recorded as income —
  // wrong by twice its own size.
  await fresh(page);
  await page.getByTestId('add-button').click();
  await expect(page.getByTestId('amount-input')).toHaveValue('-');
  // Typing digits gives money OUT without touching the toggle.
  await page.getByTestId('name-input').fill('Coffee');
  await page.getByTestId('amount-input').fill('-450');
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();
  await expect(page.getByTestId('total')).toHaveText('-$4.50');

  // And an EDIT is seeded from the record, not from the default.
  await page.getByTestId('edit-toggle').click();
  await page.getByTestId('row-edit').first().click();
  await expect(page.getByTestId('amount-input')).toHaveValue('-$4.50');
});

test('every bad field complains at once, and each clears when touched', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('error-name')).toBeVisible();
  await expect(page.getByTestId('error-amount')).toBeVisible();
  // The date is never invalid — it starts on today and the picker cannot
  // produce a bad one.
  await expect(page.getByTestId('error-date')).toBeHidden();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);

  await page.getByTestId('name-input').fill('Now named');
  await expect(page.getByTestId('error-name')).toBeHidden();
  await expect(page.getByTestId('error-amount')).toBeVisible();
});

test('an unparseable amount is refused rather than rounded', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Third of a cent');
  // 1.005 could round to 100 or 101 cents. Refusing is the rule.
  await page.getByTestId('amount-input').fill('1.005');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('error-amount')).toHaveText('That is not an amount');
  await expect(page.getByTestId('save-button')).toBeVisible();
  expect(await storedTxns(page)).toEqual([]);
});

test('the list is newest first, whatever order they were entered', async ({ page }) => {
  await fresh(page);
  // Trailing dots: bare digits now fill from the cents, so '2' would be 2c.
  await addTransaction(page, { name: 'middle', amount: '2.', day: '2026-06-15' });
  await addTransaction(page, { name: 'oldest', amount: '1.', day: '2026-01-05' });
  await addTransaction(page, { name: 'newest', amount: '3.', day: '2026-08-01' });

  expect((await rows(page)).map((r) => r.name)).toEqual(['newest', 'middle', 'oldest']);
  await expect(page.getByTestId('total')).toHaveText('$6.00');
});

test('a description is optional and its line is absent without one', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Bare', amount: '1' });
  await expect(page.getByTestId('txn-description')).toHaveCount(0);
});
