/**
 * The device is the only copy.
 *
 * These are the tests that matter most, because there is no server to
 * recover from. The damaged-store cases each assert the same thing from a
 * different angle: **the app must not write over data it could not read.**
 */
import { expect, test } from '@playwright/test';
import { addTransaction, fresh, rows, stored, withStore, KEY } from './helpers';
import { STORE_VERSION } from '@acctmind/core';

test('a transaction survives a reload', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Groceries', description: 'co-op', amount: '-84.37' });

  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  expect(await rows(page)).toEqual([
    { name: 'Groceries', description: 'co-op', amount: '-$84.37', date: expect.any(String) },
  ]);
});

test('a store written by an older run loads', async ({ page }) => {
  await withStore(page, JSON.stringify({
    v: 1,
    txns: [{ id: 'seed1', name: 'Rent', description: '', amount: -185050, date: '2026-08-01', created: 1 }],
  }));
  expect((await rows(page))[0]?.amount).toBe('-$1,850.50');
  await expect(page.getByTestId('total')).toHaveText('-$1,850.50');
});

test.describe('a damaged store', () => {
  const DAMAGED = '{"v":1,"txns":[';

  test('is reported, not silently emptied', async ({ page }) => {
    await withStore(page, DAMAGED);
    await expect(page.getByTestId('blocked')).toBeVisible();
    // The tells of the bug this guards: the normal screen, and an empty list.
    await expect(page.getByTestId('empty-state')).toBeHidden();
    await expect(page.getByTestId('add-button')).toBeHidden();
  });

  test('is left exactly as it was found', async ({ page }) => {
    await withStore(page, DAMAGED);
    await expect(page.getByTestId('blocked')).toBeVisible();
    // Byte for byte. Anything else means something wrote.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), KEY)).toBe(DAMAGED);
  });

  test('takes two presses to discard', async ({ page }) => {
    await withStore(page, DAMAGED);
    await page.getByTestId('start-fresh').click();
    // The first press only reveals the real one — it must not itself write.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), KEY)).toBe(DAMAGED);

    await page.getByTestId('start-fresh-confirm').click();
    // STORE_VERSION, not a literal: this said `v: 1` after the store went to
    // v2 and nothing noticed, because the gesture suite had not been re-run.
    await expect.poll(async () => (await stored(page) as { txns: unknown[] }).txns).toEqual([]);
  });

  test('a version this build cannot read is damage, not an upgrade', async ({ page }) => {
    // A file from a NEWER AcctMind. Rendering it would be wrong; overwriting
    // it with a downgrade would be worse.
    // One PAST whatever this build writes, so the case stays "from the
    // future" as the store version moves. Written as a literal it stopped
    // testing anything the day STORE_VERSION caught up with it.
    const future = STORE_VERSION + 1;
    await withStore(page, JSON.stringify({ v: future, txns: [] }));
    await expect(page.getByTestId('blocked')).toBeVisible();
    await expect(page.getByTestId('blocked')).toContainText(`version ${future}`);
  });
});

test('unreadable rows are skipped, and the app says how many', async ({ page }) => {
  await withStore(page, JSON.stringify({
    v: 1,
    txns: [
      { id: 'ok', name: 'Kept', description: '', amount: 100, date: '2026-08-20', created: 1 },
      null,
      { id: 'floaty', name: 'Dropped', amount: 4.5, date: '2026-08-20' },
      { id: 'badday', name: 'Dropped', amount: 100, date: '2026-02-30' },
    ],
  }));

  // One bad row must not cost the good ones.
  await expect(page.getByTestId('dropped-banner')).toContainText('3 saved rows');
  expect((await rows(page)).map((r) => r.name)).toEqual(['Kept']);
  await expect(page.getByTestId('add-button')).toBeVisible();
});

test('adding after a partial load keeps the rows that survived', async ({ page }) => {
  await withStore(page, JSON.stringify({
    v: 1,
    txns: [
      { id: 'ok', name: 'Kept', description: '', amount: 100, date: '2026-08-20', created: 1 },
      'rubbish',
    ],
  }));
  await addTransaction(page, { name: 'New', amount: '2' });

  const store = await stored(page) as { txns: { name: string }[] };
  expect(store.txns.map((t) => t.name).sort()).toEqual(['Kept', 'New']);
});
