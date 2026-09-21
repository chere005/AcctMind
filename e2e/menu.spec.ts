/**
 * The cog in the top right, and the three things behind it.
 *
 * Sean, 2026-09-21: "add a user icon in the top right similar to CalMind..
 * i want the drop down menu to include 'import from csv', 'export budget',
 * 'whole dollars' (which has a checkbox toggle)" — then "actually a cog
 * icon" — then "drop the import button next to the + button in
 * transactions". Three messages, one bar: the `.00` circle and the import
 * arrow are gone and both are rows in here now.
 *
 * What the export WRITES is core's (`csvout.test.ts`). What only this level
 * can say is that the file the browser is handed carries the budget the
 * screen was showing, which is the join nothing else checks.
 */
import { expect, test } from '@playwright/test';
import { closeMenu, fresh, openMenu, pickView, withStore } from './helpers';

const STORE = JSON.stringify({
  v: 4,
  accounts: [{ id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 1, updated: 1 }],
  categories: [{ id: 'c1', name: 'Food', color: '#66d695', order: 0, created: 1, updated: 1 }],
  lines: [{
    id: 'l1', name: 'Groceries', category: 'c1', budget: 25000, needs: 0,
    snoozed: false, order: 0, created: 1, updated: 1,
  }],
  views: [], budgets: [],
  txns: [{
    id: 't1', name: 'Coffee', description: '', amount: -450, date: '2026-08-20',
    account: 'a1', category: 'l1', order: 0, created: 1, updated: 1,
  }],
});

test('the cog is on BOTH tabs, and the old controls are gone from the bar', async ({ page }) => {
  // One place for "things about the app", reachable wherever you are —
  // CalMind's account pill sits in the same corner on every screen.
  await fresh(page);
  await expect(page.getByTestId('app-menu-button')).toBeVisible();
  await expect(page.getByTestId('whole-toggle')).toHaveCount(0);
  await expect(page.getByTestId('import-button')).toHaveCount(0);

  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('app-menu-button')).toBeVisible();
});

test('the menu holds the three rows, in order', async ({ page }) => {
  await fresh(page);
  await openMenu(page);
  await expect(page.getByTestId('menu-import')).toHaveText('Import from CSV');
  await expect(page.getByTestId('menu-export')).toHaveText('Export budget');
  await expect(page.getByTestId('menu-whole')).toContainText('Whole dollars');
});

test('Whole dollars ticks, STAYS open, and holds across a reload', async ({ page }) => {
  // A setting, not an action: the two rows above it leave for somewhere else
  // and closing behind them is right. Flipping a toggle and having the menu
  // vanish makes you reopen it to see whether it took.
  await fresh(page);
  await openMenu(page);
  await expect(page.getByTestId('menu-whole-box')).toHaveText('');

  await page.getByTestId('menu-whole').click();
  await expect(page.getByTestId('menu-whole-box')).toHaveText('✓');
  await expect(page.getByTestId('menu-whole')).toBeVisible();
  await closeMenu(page);

  await page.reload();
  await openMenu(page);
  await expect(page.getByTestId('menu-whole-box')).toHaveText('✓');
});

test('Import opens the import screen, and the menu gets out of the way', async ({ page }) => {
  await fresh(page);
  await openMenu(page);
  await page.getByTestId('menu-import').click();
  await expect(page.getByTestId('import-paste').or(page.getByTestId('import-file'))).toBeVisible();
});

test.describe('Export', () => {
  // A download event is Chromium's here; WebKit's is a different dance and
  // the file the two hand over is byte-identical, so one browser proves it.
  test.skip(({ browserName }) => browserName !== 'chromium', 'download events');

  test('hands over a CSV of the budget the screen is showing', async ({ page }) => {
  await withStore(page, STORE);
  await page.getByTestId('tab-budget').click();
  // ALL TIME, so the fixture's own $250 is what the file should carry — the
  // tab opens on the current month, where nothing has been assigned.
  await pickView(page, 'all');

  const wait = page.waitForEvent('download');
  await openMenu(page);
  await page.getByTestId('menu-export').click();
  const file = await wait;

  expect(file.suggestedFilename()).toBe('acctmind-budget-all-time.csv');
  const path = await file.path();
  const text = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
  expect(text).toBe(
    'Category,Line,Assigned,Spent,Available\r\n'
    + 'Food,Groceries,250.00,-4.50,245.50\r\n',
  );
  // …and it SAID so, which on this path is the only evidence anything left
  // the app.
  await expect(page.getByTestId('note')).toContainText('acctmind-budget-all-time.csv');
});

  test('names the MONTH it was asked from', async ({ page }) => {
  // A file exported from a screen showing September that said "all time"
  // would disagree with the screen it came from, and nothing in it would
  // say so.
  await withStore(page, STORE);
  await page.getByTestId('tab-budget').click();
  const month = await page.getByTestId('budget-month').textContent();
  expect(month).not.toBeNull();

  const wait = page.waitForEvent('download');
  await openMenu(page);
  await page.getByTestId('menu-export').click();
  const file = await wait;
  expect(file.suggestedFilename()).toMatch(/^acctmind-budget-\d{4}-\d{2}\.csv$/);
  });
});
