/**
 * Undo — the arrow left of the pencil.
 *
 * Sean, 2026-09-21: "to the left of the edit pencil icon should be an 'Undo
 * last action' button with an undo icon."
 *
 * ONE STEP, which is what "last action" means. `commit` in App.tsx is the
 * only path that changes the ledger, so what Undo takes back is whatever it
 * was handed last — and the arithmetic of putting it back is core's
 * `undoTo`, which is a set of EDITS rather than a rewind (see its note, and
 * `store.test.ts`, on why a rewind loses the next merge).
 *
 * What is only checkable here is the wiring: that the button is where he
 * asked for it, that it is dead until there is something to take back, that
 * it takes back exactly one thing, and that it is on both tabs because the
 * thing it acts on is the ledger rather than the screen.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTransaction, fresh, rows, stored } from './helpers';

/** Where a control sits along the bar, for asserting an ORDER. */
async function xOf(page: Page, id: string): Promise<number> {
  const box = await page.getByTestId(id).boundingBox();
  expect(box, `${id} is not on screen`).not.toBeNull();
  return (box as NonNullable<typeof box>).x;
}

test('it sits to the LEFT of the pencil, on both tabs', async ({ page }) => {
  await fresh(page);
  expect(await xOf(page, 'undo-button')).toBeLessThan(await xOf(page, 'edit-toggle'));

  await page.getByTestId('tab-budget').click();
  await expect(page.getByTestId('budget-title')).toBeVisible();
  expect(await xOf(page, 'undo-button')).toBeLessThan(await xOf(page, 'budget-edit-toggle'));
});

test('a fresh device has nothing to undo, and pressing it does nothing', async ({ page }) => {
  // Drawn rather than hidden: a control that appears when it becomes usable
  // is one nobody finds, because the moment you want it is the moment after
  // you did the thing. Dimmed and disabled instead — the pick bar's Delete
  // makes the same trade for the same reason.
  await fresh(page);
  await expect(page.getByTestId('undo-button')).toBeVisible();
  await expect(page.getByTestId('undo-button')).toHaveAttribute('aria-disabled', 'true');

  await page.getByTestId('undo-button').click({ force: true });
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
});

test('it takes back an ADD, tombstone and all', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await expect(page.getByTestId('txn-row')).toHaveCount(1);
  await expect(page.getByTestId('undo-button')).not.toHaveAttribute('aria-disabled', 'true');

  await page.getByTestId('undo-button').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);

  // A TOMBSTONE, not a removal — the row was already on another device the
  // moment it was saved, and dropping it here would bring it straight back.
  const s = await stored(page) as { txns: { name: string; deleted?: true }[] };
  expect(s.txns.find((t) => t.name === 'Coffee')?.deleted).toBe(true);
});

test('it takes back an EDIT, putting the old value back', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await page.getByTestId('txn-name').first().click();
  const field = page.getByTestId('txn-name-input');
  await field.fill('Tea');
  await field.press('Enter');
  await expect(page.getByTestId('txn-name').first()).toHaveText('Tea');

  await page.getByTestId('undo-button').click();
  await expect(page.getByTestId('txn-name').first()).toHaveText('Coffee');
  expect((await rows(page))[0]?.amount).toContain('4.50');
});

test('it takes back a DELETE, and the row comes back with its clock moved', async ({ page }) => {
  /*
   * The case `undoTo` exists for. Putting the row back with its original
   * `updated` works on this device and is undone by the next merge: the
   * other device holds a tombstone stamped later, and the newer record
   * wins. The undo has to be an EDIT, which means a fresh clock.
   */
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  const before = await stored(page) as { txns: { id: string; updated: number }[] };
  const was = before.txns[0]!.updated;

  await page.getByTestId('edit-toggle').click();
  await page.getByTestId('row-delete').first().click();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);

  await page.getByTestId('undo-button').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);
  const after = await stored(page) as { txns: { id: string; updated: number; deleted?: true }[] };
  expect(after.txns[0]?.deleted).toBeUndefined();
  expect(after.txns[0]?.updated).toBeGreaterThan(was);
});

test('ONE step: undoing does not arm a redo', async ({ page }) => {
  // "Undo last action", and the button still says Undo afterwards. A second
  // press putting the change back would be a redo wearing an undo's label.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await page.getByTestId('undo-button').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);

  await expect(page.getByTestId('undo-button')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('undo-button').click({ force: true });
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
});

test('it survives a reload only as far as the ledger does', async ({ page }) => {
  // The snapshot is in memory, deliberately: it is one press of a button,
  // not a document history, and an Undo offered after a relaunch would take
  // back something the person did before they went to make coffee.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await page.reload();
  await page.getByTestId('tab-transactions').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);
  await expect(page.getByTestId('undo-button')).toHaveAttribute('aria-disabled', 'true');
});

test('it reaches the BUDGET too, from either tab', async ({ page }) => {
  // One button for one ledger. The change is made on the Budget tab and
  // taken back from the Transactions tab, which is only correct because
  // what it holds is the store rather than the screen.
  await page.goto('./');
  await expect(page.getByTestId('budget-title')).toBeVisible();
  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await page.getByTestId('manage-add').click();
  const s = await stored(page) as { categories: { id: string; deleted?: true }[] };
  const cat = s.categories.filter((c) => c.deleted !== true).slice(-1)[0]!.id;
  await page.getByTestId('manage-done').click();
  await page.getByTestId(`category-add-${cat}`).click();
  await expect(page.getByTestId('line-row-' + ((await stored(page) as {
    lines: { id: string }[] }).lines.slice(-1)[0]!.id))).toBeVisible();

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('undo-button').click();
  await page.getByTestId('tab-budget').click();
  const after = await stored(page) as { lines: { deleted?: true }[] };
  expect(after.lines.slice(-1)[0]?.deleted).toBe(true);
});
