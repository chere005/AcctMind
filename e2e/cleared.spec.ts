import { expect, test } from '@playwright/test';
import { addTransaction, fresh, reload, stored } from './helpers';

/**
 * The cleared box, far right of every transaction (Sean, 2026-09-15: "add a
 * cleared check box as the far right column in transactions").
 *
 * What is pinned: the box is the row's LAST column; a tick is stored as the
 * literal `true` and survives a reload; unticking removes the key rather than
 * writing `false`, so an uncleared row is byte-identical to one written before
 * the field existed. The last of those is the one a screen cannot show — it is
 * read straight out of the store.
 */
type StoredTxn = { id: string; name: string; cleared?: unknown };
const txns = async (page: Parameters<typeof stored>[0]) => ((await stored(page)) as { txns: StoredTxn[] }).txns;

test('the cleared box is the far-right column, ticks, persists, and unticks to no key', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });

  const box = page.getByTestId(/^txn-cleared-/);
  await expect(box).toHaveCount(1);
  // react-native-web writes aria-checked only when it is TRUE; the label is
  // the honest read of the unticked state.
  await expect(box).toHaveAttribute('aria-label', 'Coffee not cleared');

  // Far right: nothing in the row sits to the right of it.
  const rowBox = (await page.getByTestId('txn-row-body').boundingBox())!;
  const boxBox = (await box.boundingBox())!;
  const dateBox = (await page.getByTestId('txn-date').boundingBox())!;
  expect(boxBox.x, 'the box is right of the date').toBeGreaterThan(dateBox.x + dateBox.width - 1);
  expect(boxBox.x + boxBox.width, 'the box is the last thing in the row').toBeGreaterThan(rowBox.x + rowBox.width - boxBox.width - 12);

  // Not cleared: no key at all.
  expect('cleared' in (await txns(page))[0]!).toBe(false);

  await box.click();
  // (react-native-web renders accessibilityState.checked as no attribute at
  // all on a Pressable; the label carries the state.)
  await expect(box).toHaveAttribute('aria-label', 'Coffee cleared');
  await expect(box.getByText('✓')).toBeVisible();
  expect((await txns(page))[0]!.cleared).toBe(true);

  await reload(page);
  await expect(page.getByTestId(/^txn-cleared-/)).toHaveAttribute('aria-label', 'Coffee cleared');

  await page.getByTestId(/^txn-cleared-/).click();
  await expect(page.getByTestId(/^txn-cleared-/)).toHaveAttribute('aria-label', 'Coffee not cleared');
  expect('cleared' in (await txns(page))[0]!, 'unticking removes the key, never writes false').toBe(false);
});
