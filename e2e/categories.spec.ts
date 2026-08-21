/**
 * Categories: made in Manage, assigned money there, and chosen on a
 * transaction through a dropdown that filters as you type.
 */
import { expect, test, type Page } from '@playwright/test';
import { fresh, stored } from './helpers';

type Stored = {
  categories: { id: string; name: string; budget: number; deleted?: true }[];
  txns: { name: string; category: string | null }[];
};

const live = (s: Stored) => s.categories.filter((c) => c.deleted !== true);

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
async function makeCategory(page: Page, name: string, budget?: string): Promise<string> {
  const before = live(await stored(page) as Stored).length;
  await page.getByTestId('manage-add').click();
  await expect
    .poll(async () => live(await stored(page) as Stored).length)
    .toBe(before + 1);
  const s = await stored(page) as Stored;
  const id = live(s)[live(s).length - 1]?.id ?? '';
  await page.getByTestId(`manage-name-${id}`).fill(name);
  if (budget !== undefined) await page.getByTestId(`manage-budget-${id}`).fill(budget);
  return id;
}

test('the Budget tab starts empty and points at Manage', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('budget-empty')).toBeVisible();
  await expect(page.getByTestId('budget-empty')).toContainText('Manage Categories');
});

test('a category is made in Manage and carries assigned money', async ({ page }) => {
  await page.goto('./');
  await openManage(page);
  const id = await makeCategory(page, 'Groceries', '250');
  await page.getByTestId('manage-done').click();

  await expect(page.getByTestId(`category-head-${id}`)).toContainText('Groceries');
  // Assigned money is an amount like any other: integer minor units.
  const s = await stored(page) as Stored;
  expect(live(s)[0]?.budget).toBe(25000);
  await expect(page.getByTestId('budget-assigned')).toHaveText('$250.00 assigned');
});

test('"None" is always offered and never filtered away', async ({ page }) => {
  // It is a real answer, not a category that happens to match nothing.
  await page.goto('./');
  await openManage(page);
  await makeCategory(page, 'Rent');
  await page.getByTestId('manage-done').click();
  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('category-button').click();

  await page.getByTestId('category-filter').fill('zzzz');
  await expect(page.getByTestId('category-nomatch')).toBeVisible();
  await expect(page.getByTestId('category-none')).toBeVisible();
});

test('a chosen category is stored on the transaction and shows on Budget', async ({ page }) => {
  await page.goto('./');
  await openManage(page);
  const id = await makeCategory(page, 'Groceries', '250');
  await page.getByTestId('manage-done').click();

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('1250');
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${id}`).click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  const s = await stored(page) as Stored;
  expect(s.txns[0]?.category).toBe(id);

  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('budget-row')).toHaveCount(1);
  await expect(page.getByTestId(`category-head-${id}`)).toContainText('of $250.00');
});

test('deleting a category leaves its transactions alone', async ({ page }) => {
  // The row keeps its money; it just stops being filed. Losing a transaction
  // because a bookkeeping label went would be the wrong trade.
  await page.goto('./');
  await openManage(page);
  const id = await makeCategory(page, 'Groceries');
  await page.getByTestId('manage-done').click();
  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('1250');
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${id}`).click();
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
