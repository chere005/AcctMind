/**
 * Amounts, driven through the real field.
 *
 * `spec/money.json` already proves the rules. What this file adds is that the
 * FORM uses them — that no screen quietly does its own `parseFloat` on the
 * way past, and that the two round buttons do what the rules say.
 */
import { expect, test } from '@playwright/test';
import { addTransaction, fresh, rows, stored, reload } from './helpers';

// Typed into the field, with both toggles off — the default.
const CASES: [string, string, number][] = [
  // typed          shown            stored (cents)
  ['1234',          '$12.34',        1234],   // digits fill from the cents
  ['450',           '$4.50',         450],
  ['5',             '$0.05',         5],
  ['0',             '$0.00',         0],
  ['12.34',         '$12.34',        1234],   // a typed dot reads the ordinary way
  ['12.3',          '$12.30',        1230],
  ['50.',           '$50.00',        5000],   // a trailing dot means "that was the whole part"
  ['-8437',         '-$84.37',       -8437],  // a leading minus still works
  ['-84.37',        '-$84.37',       -8437],
  ['1,234.56',      '$1,234.56',     123456], // pasted grouping is noise, not an error
  ['$450',          '$4.50',         450],
];

for (const [typed, shown, cents] of CASES) {
  test(`"${typed}" reads as ${shown} and stores ${cents}`, async ({ page }) => {
    await fresh(page);
    await addTransaction(page, { name: 'x', amount: typed });

    expect((await rows(page))[0]?.amount).toBe(shown);
    const store = await stored(page) as { txns: { amount: number }[] };
    expect(store.txns[0]?.amount).toBe(cents);
    expect(Number.isInteger(store.txns[0]?.amount)).toBe(true);
  });
}

test('the preview shows what the digits mean, before saving', async ({ page }) => {
  // The whole reason two modes are safe to offer: the amount is never hidden
  // behind the digits.
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('amount-input').fill('1234');
  await expect(page.getByTestId('amount-preview')).toHaveText('$12.34');
});

test('.00 is off to begin with', async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId('whole-toggle')).toBeVisible();
  await page.getByTestId('add-button').click();
  await page.getByTestId('amount-input').fill('1450');
  await expect(page.getByTestId('amount-preview')).toHaveText('$14.50');
});

test('the .00 button reads bare digits as whole dollars', async ({ page }) => {
  await fresh(page);
  // It lives on the Transactions header now, not inside the form.
  await page.getByTestId('whole-toggle').click();

  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Rent');
  await page.getByTestId('amount-input').fill('1450');
  await expect(page.getByTestId('amount-preview')).toHaveText('$1,450.00');

  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();
  const store = await stored(page) as { txns: { amount: number }[] };
  expect(store.txns[0]?.amount).toBe(145000);
});

test('the .00 choice is remembered across a reload', async ({ page }) => {
  // A setting that reset on every launch would have to be found and flipped
  // again before every single entry, which is the same as not having it.
  await fresh(page);
  await page.getByTestId('whole-toggle').click();
  await reload(page);

  await page.getByTestId('add-button').click();
  await page.getByTestId('amount-input').fill('50');
  await expect(page.getByTestId('amount-preview')).toHaveText('$50.00');
});

test('and it is not part of the ledger', async ({ page }) => {
  // Settings must not merge. Two devices arguing about a keyboard is not
  // sync, and a preference travelling as though it were a transaction is a
  // bug waiting for the second device.
  await fresh(page);
  await page.getByTestId('whole-toggle').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Rent');
  await page.getByTestId('amount-input').fill('1450');
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  const store = await stored(page) as Record<string, unknown>;
  expect(JSON.stringify(store)).not.toContain('amountMode');
});

test('a typed dot beats the .00 button', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('whole-toggle').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('amount-input').fill('12.34');
  // Whole mode is on, but the dot is explicit and wins.
  await expect(page.getByTestId('amount-preview')).toHaveText('$12.34');
});

test('the − button and the minus key are the same thing', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('amount-input').fill('450');
  await page.getByTestId('sign-toggle').click();
  await expect(page.getByTestId('amount-preview')).toHaveText('-$4.50');
  // The cell shows the formatted amount now, not the digits that made it.
  await expect(page.getByTestId('amount-input')).toHaveValue('-$4.50');

  // Pressing it again puts it back.
  await page.getByTestId('sign-toggle').click();
  await expect(page.getByTestId('amount-preview')).toHaveText('$4.50');

  // And typing the minus reaches the same place.
  await page.getByTestId('amount-input').fill('-450');
  await expect(page.getByTestId('amount-preview')).toHaveText('-$4.50');
});

test('a third decimal is refused, not quietly trimmed', async ({ page }) => {
  // The field could have dropped the third digit and shown $1.00. It must
  // not: that is a value nobody typed, and it is exactly the substitution
  // parseAmount refuses to make. It stays on screen and previews nothing.
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('amount-input').fill('1.005');
  // Refused, so there is nothing to format: the raw text stays on screen.
  await expect(page.getByTestId('amount-input')).toHaveValue('1.005');
  await expect(page.getByTestId('amount-preview')).toHaveText('');
});

test('the total adds cents, not floats', async ({ page }) => {
  await fresh(page);
  // 0.1 + 0.2 is the canonical float failure. In cents it is 10 + 20.
  await addTransaction(page, { name: 'a', amount: '0.10' });
  await addTransaction(page, { name: 'b', amount: '0.20' });
  await expect(page.getByTestId('total')).toHaveText('$0.30');

  await addTransaction(page, { name: 'c', amount: '-0.30' });
  await expect(page.getByTestId('total')).toHaveText('$0.00');
});

test('money in and money out land on the same running total', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'pay', amount: '2400.' });
  await addTransaction(page, { name: 'rent', amount: '-1850.50' });
  await expect(page.getByTestId('total')).toHaveText('$549.50');
});
