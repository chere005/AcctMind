/**
 * Amounts, driven through the real field.
 *
 * `spec/money.json` already proves the parser. What this file adds is that
 * the parser is the thing the FORM actually uses — that no screen quietly
 * does its own `parseFloat` on the way past.
 */
import { expect, test } from '@playwright/test';
import { addTransaction, fresh, rows, stored } from './helpers';

const CASES: [string, string, number][] = [
  // typed          shown            stored (cents)
  ['12',            '$12.00',        1200],
  ['12.5',          '$12.50',        1250],
  ['0.01',          '$0.01',         1],
  ['$4.50',         '$4.50',         450],
  ['1,234.56',      '$1,234.56',     123456],
  ['-84.37',        '-$84.37',       -8437],
  ['(12.34)',       '-$12.34',       -1234],
  ['0',             '$0.00',         0],
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
  await addTransaction(page, { name: 'pay', amount: '2400' });
  await addTransaction(page, { name: 'rent', amount: '-1850.50' });
  await expect(page.getByTestId('total')).toHaveText('$549.50');
});
