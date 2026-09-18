/**
 * Importing the same days a second time.
 *
 * Sean, 2026-09-18: "if it goes back enough days which it usually will..
 * check if any transactions no longer exist in the csv, or if any values need
 * to be modified (final amounts, whether it's cleared)."
 *
 * The matching itself is core's (`reconcileRows`, with its own vectors). What
 * is only checkable here is the WIRING: that the screen shows the three
 * counts before anything is written, that a removal takes a second press, and
 * that what lands in the store is what the screen said it would be — which is
 * the one thing a plan computed in two places can get wrong.
 */
import { expect, test, type Page } from '@playwright/test';
import { fresh, stored } from './helpers';

type StoredTxn = { id: string; name: string; amount: number; date: string; deleted?: true; cleared?: true };
const live = async (page: Page): Promise<StoredTxn[]> =>
  ((await stored(page)) as { txns: StoredTxn[] }).txns.filter((t) => t.deleted !== true);

const HEAD = '"Date","Description","Amount","Status"';
const csv = (...lines: string[]): string => `${[HEAD, ...lines].join('\n')}\n`;

const DINNER = '09/16/2026","PURCHASE DINNER';
const APPLE = '09/15/2026","PURCHASE APPLE.COM';
const ZELLE = '09/14/2026","ZELLE FROM FOB ON 09/14 REF # WFCT1';

/** Pick the file and stop on the plan, without agreeing to it. */
async function load(page: Page, text: string): Promise<void> {
  await page.getByTestId('import-button').click();
  await expect(page.getByTestId('import-title')).toBeVisible();
  await page.setInputFiles('[data-testid="import-file"]', {
    name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(text),
  });
  await expect(page.getByTestId('import-plan')).toBeVisible();
}

const FIRST = csv(
  `"${DINNER}","-50.00","Pending"`,
  `"${APPLE}","-8.93","Posted"`,
  `"${ZELLE}","3500.00","Posted"`,
);

test('a second export of the same days settles, clears and removes', async ({ page }) => {
  await fresh(page);
  await load(page, FIRST);
  await expect(page.getByTestId('import-plan')).toHaveText('3 new');
  await page.getByTestId('import-add').click();
  expect(await live(page)).toHaveLength(3);

  // The bank has since: settled the dinner for more than it held, and
  // dropped the Zelle entirely. One row is new, one is untouched.
  //
  // The new row is dated the 14th on purpose — a file can only say a row is
  // gone from days it actually reaches, and without something on the 14th
  // this second export would not cover the day the Zelle sits on.
  await load(page, csv(
    `"${DINNER}","-60.00","Posted"`,
    `"${APPLE}","-8.93","Posted"`,
    '"09/14/2026","PURCHASE NEW THING","-10.00","Posted"',
  ));
  await expect(page.getByTestId('import-plan'))
    .toHaveText('1 new, 1 changed, 1 no longer in the file, 1 already here');

  // Both are LISTED, not just counted — a number on its own is something to
  // agree to blindly.
  await expect(page.getByTestId(/^import-changed-/)).toHaveText(/-\$50\.00 → -\$60\.00/);
  await expect(page.getByTestId(/^import-missing-/)).toContainText('$3,500.00');

  // A removal takes TWO presses. One press only arms it.
  await page.getByTestId('import-add').click();
  await expect(page.getByTestId('import-add')).toContainText('Press again');
  expect(await live(page)).toHaveLength(3);

  await page.getByTestId('import-add').click();
  await expect(page.getByTestId('import-title')).toBeHidden();

  const rows = await live(page);
  expect(rows.map((t) => t.name).sort()).toEqual(['Apple', 'Dinner', 'New Thing']);
  const dinner = rows.find((t) => t.name === 'Dinner');
  expect(dinner?.amount).toBe(-6000);
  expect(dinner?.cleared).toBe(true);
});

test('a plain second import with nothing to remove is still one press', async ({ page }) => {
  await fresh(page);
  await load(page, FIRST);
  await page.getByTestId('import-add').click();

  await load(page, csv(
    `"${DINNER}","-50.00","Pending"`,
    `"${APPLE}","-8.93","Posted"`,
    `"${ZELLE}","3500.00","Posted"`,
    '"09/16/2026","PURCHASE NEW THING","-10.00","Posted"',
  ));
  await expect(page.getByTestId('import-add')).toHaveText('Add 1 new transaction');
  await page.getByTestId('import-add').click();
  await expect(page.getByTestId('import-title')).toBeHidden();
  expect(await live(page)).toHaveLength(4);
});
