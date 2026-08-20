/** The date button and the grid behind it. */
import { expect, test } from '@playwright/test';
import { fresh, pickDay, rows } from './helpers';

test('the date defaults to today', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();

  // Computed in the BROWSER's timezone, from its own clock — the same local
  // calendar the app uses. Deriving it here from the runner's clock would
  // compare two different notions of today.
  const expected = await page.evaluate(() => {
    const d = new Date();
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return `${mon} ${d.getDate()}`;
  });
  await expect(page.getByTestId('date-value')).toHaveText(expected);
});

test('the grid opens on the chosen date and walks month by month', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('date-button').click();

  const label = page.getByTestId('month-label');
  const start = await label.innerText();
  await page.getByTestId('month-next').click();
  await expect(label).not.toHaveText(start);
  await page.getByTestId('month-prev').click();
  await expect(label).toHaveText(start);
});

test('picking a day closes the grid and shows the day', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await pickDay(page, '2026-07-18');

  await expect(page.getByTestId('month-label')).toBeHidden();
  await expect(page.getByTestId('date-value')).toHaveText('Jul 18');
});

test('a date in another year keeps its year in the list', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Last year');
  await page.getByTestId('amount-input').fill('10');
  await pickDay(page, '2025-03-09');
  await page.getByTestId('save-button').click();

  // The year is dropped only when it is the current one.
  expect((await rows(page))[0]?.date).toBe('Mar 9, 2025');
});

test('cancelling the grid leaves the date alone', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  const before = await page.getByTestId('date-value').innerText();

  await page.getByTestId('date-button').click();
  await page.getByTestId('month-next').click();
  await page.getByTestId('pick-cancel').click();

  await expect(page.getByTestId('month-label')).toBeHidden();
  await expect(page.getByTestId('date-value')).toHaveText(before);
});

test('Today returns to today from anywhere in the calendar', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  const today = await page.getByTestId('date-value').innerText();

  await pickDay(page, '2025-03-09');
  await expect(page.getByTestId('date-value')).not.toHaveText(today);

  await page.getByTestId('date-button').click();
  await page.getByTestId('pick-today').click();
  await expect(page.getByTestId('date-value')).toHaveText(today);
});

test('reopening the grid lands on the chosen date, not where it was left', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('add-button').click();
  await pickDay(page, '2025-03-09');

  await page.getByTestId('date-button').click();
  await expect(page.getByTestId('month-label')).toHaveText('March 2025');
});
