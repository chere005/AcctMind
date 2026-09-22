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
 * screen was showing — and since Sean took the View dropdown out the same day
 * ("get rid of the view dropdown and all time.. always have a month
 * selected"), the budget the screen is showing is always a MONTH: the one the
 * stepper is on. That join is checked nowhere else.
 */
import { expect, test } from '@playwright/test';
import { closeMenu, fresh, monthBudget, openMenu, thisMonthSet, withStore } from './helpers';

/** The month the Budget tab opens on, `YYYY-MM` — the set key without its `m:`. */
const month = (): string => thisMonthSet().slice(2);

/**
 * $250 assigned and $4.50 spent, both IN THE MONTH THE TAB OPENS ON.
 *
 * The money sat on `line.budget` and the transaction in a fixed August until
 * 2026-09-21, and the test picked All Time so the two would meet. Neither
 * half reaches the screen now: a month reads its OWN `budgets` record —
 * `line.budget` is the old All Time number and nothing draws it — and counts
 * only the transactions dated inside it. Written the old way this fixture
 * would export a line of zeroes, and every number below would be asserting
 * on nothing. `budget: 0` on the line is left deliberately empty: an export
 * that went back to reading All Time exports $0.00 and says so.
 *
 * A FUNCTION, not a constant — `tips.spec.ts`'s reason, and it applies to
 * every clock-dated fixture in here: the set is `m:YYYY-MM` for today, and a
 * worker that imports the file in one month and runs the test in the next
 * would seed a month the tab is not looking at.
 */
const STORE = () => JSON.stringify({
  v: 4,
  accounts: [{ id: 'a1', name: 'Account', color: '#4c8bf0', order: 0, created: 1, updated: 1 }],
  categories: [{ id: 'c1', name: 'Food', color: '#66d695', order: 0, created: 1, updated: 1 }],
  lines: [{
    id: 'l1', name: 'Groceries', category: 'c1', budget: 0, needs: 0,
    snoozed: false, order: 0, created: 1, updated: 1,
  }],
  budgets: [monthBudget('l1', 25000)],
  txns: [{
    id: 't1', name: 'Coffee', description: '', amount: -450, date: `${month()}-15`,
    account: 'a1', category: 'l1', order: 0, created: 1, updated: 1,
  }],
});

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "October 2026" -> "2026-10": the label the screen DRAWS, read as a month.
 *
 * Derived from the label rather than computed from the clock on purpose —
 * the claim is that the file and the screen name the same month, and a test
 * that did its own month arithmetic could agree with the export while both
 * disagreed with what a person is looking at.
 */
function monthFromLabel(label: string): string {
  const [name, year] = label.trim().split(' ') as [string, string];
  expect(MONTHS, `"${label}" is not a month the screen draws`).toContain(name);
  return `${year}-${String(MONTHS.indexOf(name) + 1).padStart(2, '0')}`;
}

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
    const m = month();
    await withStore(page, STORE());
    await page.getByTestId('tab-budget').click();
    // The tab opens on a month and there is no way to ask it for anything
    // else, so the fixture's $250 is what the screen reads and what the file
    // has to carry. Asserting the drawn figure FIRST is what makes the two
    // halves a join: a file of zeroes matching a screen of zeroes would
    // otherwise pass every line below.
    await expect(page.getByTestId('budget-assigned')).toHaveText('$250.00 Assigned');

    const wait = page.waitForEvent('download');
    await openMenu(page);
    await page.getByTestId('menu-export').click();
    const file = await wait;

    expect(file.suggestedFilename()).toBe(`acctmind-budget-${m}.csv`);
    const path = await file.path();
    const text = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
    expect(text).toBe(
      'Category,Line,Assigned,Spent,Available\r\n'
      + 'Food,Groceries,250.00,-4.50,245.50\r\n',
    );
    // …and it SAID so, which on this path is the only evidence anything left
    // the app.
    await expect(page.getByTestId('note')).toContainText(`acctmind-budget-${m}.csv`);
  });

  test('names the month the STEPPER is on, and carries that month with it', async ({ page }) => {
    // A file exported from a screen showing October and named for September
    // would disagree with the screen it came from, and nothing in it would
    // say so. It was "all-time" that could disagree until 2026-09-21; there
    // is no such file any more, so what is left to prove is that the name
    // follows the STEPPER rather than the calendar — which is why this steps
    // BEFORE exporting. An export wired to today's month passes every
    // assertion here without that press.
    await withStore(page, STORE());
    await page.getByTestId('tab-budget').click();
    const opened = await page.getByTestId('budget-month').textContent();
    expect(opened).not.toBeNull();
    await page.getByTestId('budget-month-next').click();
    await expect(page.getByTestId('budget-month')).not.toHaveText(opened ?? '');
    const label = (await page.getByTestId('budget-month').textContent()) ?? '';

    const wait = page.waitForEvent('download');
    await openMenu(page);
    await page.getByTestId('menu-export').click();
    const file = await wait;

    expect(file.suggestedFilename()).toBe(`acctmind-budget-${monthFromLabel(label)}.csv`);
    // And the NUMBERS stepped with the name. A file that says October and
    // holds September's $250 passes a name-only check, which is the shape of
    // check this repo does not keep: next month has nothing assigned in it
    // and nothing spent in it, and all it holds is what this month left
    // behind — $250 assigned less the $4.50 that moved.
    const path = await file.path();
    const text = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
    expect(text).toBe(
      'Category,Line,Assigned,Spent,Available\r\n'
      + 'Food,Groceries,0.00,0.00,245.50\r\n',
    );
  });
});
