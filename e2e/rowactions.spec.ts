/**
 * Holding a row down: edit, duplicate, copy, delete.
 *
 * Every assertion here checks the DEVICE as well as the screen where the
 * ledger changed. A row that vanishes from a list and survives in storage is
 * the shape of bug this project cares about most — and for delete it is the
 * likely one, because a delete has to persist as a tombstone rather than as
 * an absence.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTransaction, fresh, reload, rows, stored } from './helpers';

type Stored = { txns: { id: string; name: string; amount: number; deleted?: true }[] };

/** Hold a row until its actions appear. */
async function hold(page: Page, index = 0): Promise<void> {
  const row = page.getByTestId('txn-row-body').nth(index);
  const box = await row.boundingBox();
  if (box === null) throw new Error('the row has no box to press');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Longer than the platform's long-press threshold, and short enough that a
  // failure reads as a failure rather than a hang.
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByTestId('row-actions')).toBeVisible();
}

test('a held row offers the four actions, delete furthest right', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await hold(page);

  for (const id of ['row-edit', 'row-duplicate', 'row-copy', 'row-delete']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }

  // Right to left: delete, copy, duplicate, edit. Read off the real geometry
  // rather than the source order, because a flex direction can reverse it.
  const xs: number[] = [];
  for (const id of ['row-edit', 'row-duplicate', 'row-copy', 'row-delete']) {
    const box = await page.getByTestId(id).boundingBox();
    xs.push(box?.x ?? -1);
  }
  expect(xs[0]).toBeLessThan(xs[1] ?? 0);
  expect(xs[1]).toBeLessThan(xs[2] ?? 0);
  expect(xs[2]).toBeLessThan(xs[3] ?? 0);
});

test('nothing offers actions until a row is actually held', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await expect(page.getByTestId('row-actions')).toBeHidden();
  // A plain tap is not a hold.
  await page.getByTestId('txn-row-body').first().click();
  await expect(page.getByTestId('row-actions')).toBeHidden();
});

test('delete leaves a tombstone, not an absence', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await hold(page);
  await page.getByTestId('row-delete').click();

  await expect(page.getByTestId('txn-row')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText('$0.00');

  // The record is still on the device, marked dead. Dropping it would work
  // here and be undone by the next merge, because every other device still
  // has it and nothing would say it had gone.
  const store = await stored(page) as Stored;
  expect(store.txns).toHaveLength(1);
  expect(store.txns[0]?.deleted).toBe(true);
});

test('a deleted row stays deleted across a reload', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await hold(page);
  await page.getByTestId('row-delete').click();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);

  await reload(page);
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
});

test('duplicate makes a second, separate transaction', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await hold(page);
  await page.getByTestId('row-duplicate').click();

  await expect(page.getByTestId('txn-row')).toHaveCount(2);
  await expect(page.getByTestId('total')).toHaveText('$9.00');

  const store = await stored(page) as Stored;
  expect(store.txns).toHaveLength(2);
  // Separate ids, or the merge would treat them as one record and the second
  // would disappear the first time two devices met.
  expect(store.txns[0]?.id).not.toBe(store.txns[1]?.id);
  expect(store.txns.map((t) => t.amount)).toEqual([450, 450]);
});

test('edit opens the row filled in, and replaces it rather than adding', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', description: 'co-op', amount: '450' });
  const before = (await stored(page) as Stored).txns[0]?.id;

  await hold(page);
  await page.getByTestId('row-edit').click();
  await expect(page.getByTestId('save-button')).toBeVisible();

  // Filled in from the record, with the amount in canonical form so it reads
  // the same whichever entry mode is on.
  await expect(page.getByTestId('name-input')).toHaveValue('Coffee');
  await expect(page.getByTestId('description-input')).toHaveValue('co-op');
  await expect(page.getByTestId('amount-preview')).toHaveText('$4.50');

  await page.getByTestId('name-input').fill('Tea');
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  expect(await rows(page)).toHaveLength(1);
  const store = await stored(page) as Stored;
  expect(store.txns).toHaveLength(1);
  expect(store.txns[0]?.name).toBe('Tea');
  // The SAME transaction, edited. A new id would leave the old one on every
  // other device for ever.
  expect(store.txns[0]?.id).toBe(before);
});

test('an edit that changes the amount re-reads it under the entry rules', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await hold(page);
  await page.getByTestId('row-edit').click();
  await page.getByTestId('amount-input').fill('1275');
  await expect(page.getByTestId('amount-preview')).toHaveText('$12.75');
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();
  expect((await stored(page) as Stored).txns[0]?.amount).toBe(1275);
});

test('cancelling an edit changes nothing', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  const before = await stored(page);

  await hold(page);
  await page.getByTestId('row-edit').click();
  await page.getByTestId('name-input').fill('Tea');
  await page.getByTestId('cancel-button').click();
  await expect(page.getByTestId('cancel-button')).toBeHidden();

  expect(await stored(page)).toEqual(before);
});

test('the add button still adds, after an edit', async ({ page }) => {
  // The form is shared, so the edit target has to be cleared when it closes.
  // Left set, the next + would silently overwrite the row last edited.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await hold(page);
  await page.getByTestId('row-edit').click();
  await page.getByTestId('cancel-button').click();

  await addTransaction(page, { name: 'Tea', amount: '300' });
  await expect(page.getByTestId('txn-row')).toHaveCount(2);
});
