/**
 * Categories, the lines inside them, and filing a transaction against one.
 *
 * Since v4 a category is a HEADING and holds no money — the + beside its name
 * adds a LINE, the line holds the budget, and a transaction is filed against
 * the line. These tests were written for the old one-level model and are
 * rewritten rather than deleted: every one of them still describes something
 * the app has to do, just one level down.
 */
import { expect, test, type Page } from '@playwright/test';
import { fresh, stored } from './helpers';

type Stored = {
  categories: { id: string; name: string; deleted?: true }[];
  lines: { id: string; name: string; category: string; budget: number; deleted?: true }[];
  txns: { name: string; category: string | null }[];
};

const live = (s: Stored) => s.categories.filter((c) => c.deleted !== true);
const liveLines = (s: Stored) => s.lines.filter((l) => l.deleted !== true);

/*
 * Desktop only, and worth saying why rather than leaving it to be found.
 *
 * Under the mobile project react-native-web does not re-render a Modal's list
 * in response to a programmatic `fill`, so every assertion about what the
 * dropdown SHOWS tests the harness rather than the app. The rule itself —
 * substring, case-insensitive, trimmed, empty-is-everything — is core's
 * `filterByName` with six unit tests that run everywhere and do not need a
 * browser at all. That is the right place for it; it was in the component
 * first, which is exactly why it could only be tested through a dropdown.
 */
test.beforeEach(({}, info) => {
  test.skip(info.project.name === 'mobile', 'the harness cannot drive a Modal list here');
});

/** Open the category manager. Separate from making one: the modal STAYS open,
 *  so opening it per category would try to click the picker behind it. */
async function openManage(page: Page): Promise<void> {
  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await expect(page.getByTestId('manage-title')).toHaveText('Categories');
}

/**
 * Make a category, with the manager already open.
 *
 * WAITS for the write to land before reading the new id. Saving is async, so
 * reading straight after the click can return the store as it was — and the
 * id of the PREVIOUS category, which then gets this one's name typed into it.
 * That produced a filter test failing on a filter that was working perfectly.
 */
async function makeCategory(page: Page, name: string): Promise<string> {
  const before = live(await stored(page) as Stored).length;
  await page.getByTestId('manage-add').click();
  await expect
    .poll(async () => live(await stored(page) as Stored).length)
    .toBe(before + 1);
  const s = await stored(page) as Stored;
  const id = live(s)[live(s).length - 1]?.id ?? '';
  await page.getByTestId(`manage-name-${id}`).fill(name);
  return id;
}

/**
 * Add a line to a category through the + beside its name, and give it a
 * budget. Manage must already be CLOSED — the + is on the Budget screen.
 */
async function makeLine(page: Page, category: string, name: string, budget: string): Promise<string> {
  await page.getByTestId(`category-add-${category}`).click();
  await expect(page.getByTestId('line-save')).toBeVisible();
  await page.getByTestId('line-name').click();
  await page.getByTestId('line-name').fill(name);
  await page.getByTestId('line-budget').click();
  await page.getByTestId('line-budget').fill(budget);
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();
  const s = await stored(page) as Stored;
  return liveLines(s).find((l) => l.name === name)?.id ?? '';
}

test('the Budget tab starts empty and points at Manage', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('budget-empty')).toBeVisible();
  await expect(page.getByTestId('budget-empty')).toContainText('Manage Categories');
});

test('a category is a heading, and the money is on the line inside it', async ({ page }) => {
  await page.goto('./');
  await openManage(page);
  const id = await makeCategory(page, 'Groceries');
  await page.getByTestId('manage-done').click();
  await expect(page.getByTestId(`category-head-${id}`)).toContainText('Groceries');

  const line = await makeLine(page, id, 'Produce', '250');

  const s = await stored(page) as Stored;
  // Integer minor units, like every amount in the ledger.
  expect(liveLines(s)[0]?.budget).toBe(25000);
  expect(liveLines(s)[0]?.category).toBe(id);
  // The CATEGORY holds no money of its own. Two numbers that must agree are
  // two numbers that eventually will not.
  expect(live(s)[0]).not.toHaveProperty('budget');

  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$250.00');
  await expect(page.getByTestId('budget-assigned')).toHaveText('$250.00 assigned');
});

test('a line shows budgeted, spent and available, and available is the sum', async ({ page }) => {
  // The three columns the tab exists for. `available` is budgeted PLUS spent,
  // because money out is negative — written as a difference it reads $262.50
  // of a $250 budget after spending $12.50, which is plausible enough on one
  // line to survive a review and wrong on every line at once.
  await page.goto('./');
  await openManage(page);
  const cat = await makeCategory(page, 'Groceries');
  await page.getByTestId('manage-done').click();
  const line = await makeLine(page, cat, 'Produce', '250');

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('-1250');
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${line}`).click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$250.00');
  await expect(page.getByTestId(`line-spent-${line}`)).toHaveText('-$12.50');
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$237.50');
});

test('"None" is always offered and never filtered away', async ({ page }) => {
  // It is a real answer, not a line that happens to match nothing.
  await page.goto('./');
  await openManage(page);
  const cat = await makeCategory(page, 'Rent');
  await page.getByTestId('manage-done').click();
  await makeLine(page, cat, 'Flat', '1850');
  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('category-button').click();

  await page.getByTestId('category-filter').fill('zzzz');
  await expect(page.getByTestId('category-nomatch')).toBeVisible();
  await expect(page.getByTestId('category-none')).toBeVisible();
});

test('a chosen line is stored on the transaction and rolls up to its category', async ({ page }) => {
  await page.goto('./');
  await openManage(page);
  const cat = await makeCategory(page, 'Groceries');
  await page.getByTestId('manage-done').click();
  const line = await makeLine(page, cat, 'Produce', '250');

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('1250');
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${line}`).click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  const s = await stored(page) as Stored;
  // The LINE id, not the category's — that is the whole of the v4 change.
  expect(s.txns[0]?.category).toBe(line);
  expect(s.txns[0]?.category).not.toBe(cat);

  await page.getByTestId('tab-budget').click();
  // The heading carries ONE number — available — summed over its lines, so a
  // folded category still answers "is there any left". $250 budgeted and
  // $12.50 IN (this one is a credit) leaves $262.50.
  await expect(page.getByTestId(`category-available-${cat}`)).toHaveText('$262.50');
});

test('deleting a category leaves its transactions alone', async ({ page }) => {
  // The row keeps its money; it just stops being filed. Losing a transaction
  // because a bookkeeping label went would be the wrong trade.
  await page.goto('./');
  await openManage(page);
  const id = await makeCategory(page, 'Groceries');
  await page.getByTestId('manage-done').click();
  const line = await makeLine(page, id, 'Produce', '250');

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('1250');
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${line}`).click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  await page.getByTestId('tab-budget').click();
  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await page.getByTestId(`manage-delete-${id}`).click();
  await page.getByTestId('manage-done').click();

  await page.getByTestId('tab-transactions').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);
  await expect(page.getByTestId('total')).toHaveText('$12.50');
});
