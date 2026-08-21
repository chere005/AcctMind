/**
 * Accounts, categories, and the screens that manage them.
 *
 * The tier that went in with no tests at all — twelve controls asserted by
 * nothing. Written after two bugs shipped through a green suite, so the
 * assertions here lean on what a person would SEE rather than on what the
 * code happens to hold.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTransaction, fresh, stored } from './helpers';

type Stored = {
  accounts: { id: string; name: string; color: string; deleted?: true }[];
  categories: { id: string; name: string; budget: number; deleted?: true }[];
  txns: { name: string; category: string | null }[];
};

/** Open Manage from the picker's last row — the only way in. */
async function openManage(page: Page): Promise<void> {
  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await expect(page.getByTestId('manage-title')).toBeVisible();
}

test('the app opens on Budget, and the bar is at the BOTTOM', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('budget-title')).toBeVisible();

  // Below the content, not above it. This shipped styled as a bottom bar
  // while still first in the JSX, so it rendered under the title and the
  // change read as never having arrived.
  const bar = await page.getByTestId('tab-budget').boundingBox();
  const title = await page.getByTestId('budget-title').boundingBox();
  expect(bar?.y ?? 0).toBeGreaterThan(title?.y ?? 0);
});

test('the tabs switch between the two screens', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('budget-title')).toBeVisible();
  await page.getByTestId('tab-transactions').click();
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('budget-title')).toBeHidden();
  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('budget-title')).toBeVisible();
});

test('a fresh device already has one account to add into', async ({ page }) => {
  // Without it the + has no account to hand the form and every transaction is
  // refused — a dead end reached by doing nothing wrong.
  await fresh(page);
  const store = await stored(page) as Stored;
  expect(store.accounts.filter((a) => a.deleted !== true)).toHaveLength(1);
  await expect(page.getByTestId('account-section')).toHaveCount(1);
});

test('each account has its own + that adds into THAT account', async ({ page }) => {
  await fresh(page);
  const store = await stored(page) as Stored;
  const id = store.accounts[0]?.id;
  await page.getByTestId(`account-add-${id}`).click();
  await expect(page.getByTestId('save-button')).toBeVisible();
  await page.getByTestId('name-input').fill('Coffee');
  await page.getByTestId('amount-input').fill('450');
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  const after = await stored(page) as Stored & { txns: { account: string }[] };
  expect(after.txns[0]?.account).toBe(id);
});

test('an account folds shut and the collapse-all folds every one', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await expect(page.getByTestId('txn-row')).toHaveCount(1);

  const store = await stored(page) as Stored;
  await page.getByTestId(`account-head-${store.accounts[0]?.id}`).click();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
  // The SECTION is still there — folded, not gone.
  await expect(page.getByTestId('account-section')).toHaveCount(1);

  await page.getByTestId(`account-head-${store.accounts[0]?.id}`).click();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);

  await page.getByTestId('collapse-all').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
  await page.getByTestId('collapse-all').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);
});

test('accounts are made in Manage, and nowhere else', async ({ page }) => {
  await fresh(page);
  await openManage(page);
  await page.getByTestId('manage-add').click();

  const store = await stored(page) as Stored;
  const live = store.accounts.filter((a) => a.deleted !== true);
  expect(live).toHaveLength(2);
  // A new one takes the next colour rather than always opening blue, so a
  // list of them is telling apart at a glance.
  expect(live[0]?.color).not.toBe(live[1]?.color);
});

test('renaming an account renames it everywhere at once', async ({ page }) => {
  await fresh(page);
  const before = await stored(page) as Stored;
  const id = before.accounts[0]?.id;

  await openManage(page);
  await page.getByTestId(`manage-name-${id}`).fill('Current');
  await page.getByTestId('manage-done').click();

  // The section header follows, because a transaction points at an account by
  // id and never carries its name.
  await expect(page.getByTestId(`account-head-${id}`)).toContainText('Current');
});

test('the + beside a category opens the form already filed under it', async ({ page }) => {
  // Sean, 2026-08-21: "An add button by the category name is fine." The point
  // of it is the preset — pressing + beside Groceries has already answered
  // "which category", and a form that asks again is asking twice.
  await page.goto('./');
  await expect(page.getByTestId('budget-title')).toBeVisible();

  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await page.getByTestId('manage-add').click();
  const store = await stored(page) as Stored;
  const cat = store.categories.filter((c) => c.deleted !== true)[0];
  await page.getByTestId(`manage-name-${cat?.id}`).fill('Groceries');
  await page.getByTestId('manage-done').click();

  await page.getByTestId(`category-add-${cat?.id}`).click();
  await expect(page.getByTestId('save-button')).toBeVisible();
  // Filled in, not blank: this is the whole feature.
  await expect(page.getByTestId('category-value')).toHaveText('Groceries');

  /*
   * CLICK, then fill. Under the mobile project a `fill` on this modal's input
   * silently does nothing when the form was opened from Budget: the value
   * comes straight back empty, React having re-rendered the controlled input
   * from a state that never changed, and the only symptom is Save doing
   * nothing while the form reports "Name is required". Focusing the field
   * first is what makes the change event land. Chromium does not need it,
   * which is exactly why it is written down here.
   */
  await page.getByTestId('name-input').click();
  await page.getByTestId('name-input').fill('Apples');
  await page.getByTestId('amount-input').click();
  await page.getByTestId('amount-input').fill('-1250');
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  // And it lands ON the record, so it is what Budget totals and what syncs.
  const after = await stored(page) as Stored;
  expect(after.txns.find((t) => t.name === 'Apples')?.category).toBe(cat?.id);
});

test("an account's colour is chosen from the tray and rides on the record", async ({ page }) => {
  // The colour tray was twelve controls asserted by nothing. It matters more
  // than it looks: the colour is what tells two accounts apart in the picker,
  // in the section headers and in the rainbow dot, and it has to travel — a
  // colour that lived only on the device that picked it would make the same
  // ledger look different on the phone and the Mac.
  await fresh(page);
  const before = await stored(page) as Stored;
  const id = before.accounts[0]?.id as string;
  const was = before.accounts[0]?.color as string;

  await openManage(page);
  await page.getByTestId(`manage-color-${id}`).click();

  // DERIVED from what the tray actually offers, never a hard-coded hex. A
  // literal here would keep passing after the palette changed — it would just
  // stop finding the control and stop proving anything, which is the shape of
  // vacuous test peer.test.ts already paid for once.
  const offered = await page.getByTestId(/^manage-swatch-/).evaluateAll((els) =>
    els.map((el) => `#${(el.getAttribute('data-testid') ?? '').replace('manage-swatch-', '')}`));
  expect(offered.length).toBeGreaterThan(1);
  const want = offered.find((hex) => hex.toLowerCase() !== was.toLowerCase());
  expect(want).toBeDefined();

  await page.getByTestId(`manage-swatch-${(want as string).slice(1)}`).click();
  // The tray shuts on choosing: it covers the row it belongs to.
  await expect(page.getByTestId(`manage-swatch-${(want as string).slice(1)}`)).toBeHidden();

  const after = await stored(page) as Stored;
  const now = after.accounts.find((a) => a.id === id);
  expect(now?.color.toLowerCase()).toBe((want as string).toLowerCase());
  expect(now?.color.toLowerCase()).not.toBe(was.toLowerCase());
});

test('the LAST account cannot be deleted', async ({ page }) => {
  // Every transaction has to live somewhere; removing the only home would
  // strand them all.
  await fresh(page);
  const store = await stored(page) as Stored;
  await openManage(page);
  await page.getByTestId(`manage-delete-${store.accounts[0]?.id}`).click();

  const after = await stored(page) as Stored;
  expect(after.accounts.filter((a) => a.deleted !== true)).toHaveLength(1);
});

test('a deleted account leaves a tombstone, like everything else', async ({ page }) => {
  await fresh(page);
  await openManage(page);
  await page.getByTestId('manage-add').click();
  const two = await stored(page) as Stored;
  const extra = two.accounts.filter((a) => a.deleted !== true)[1]?.id;

  await page.getByTestId(`manage-delete-${extra}`).click();
  const after = await stored(page) as Stored;
  // Still present, marked dead — a delete that vanished would be handed back
  // by the next merge.
  expect(after.accounts.find((a) => a.id === extra)?.deleted).toBe(true);
});
