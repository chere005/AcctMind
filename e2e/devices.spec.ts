/**
 * What the browser must NOT have.
 *
 * Local-network sync is Apple-only: the native module does not exist on the
 * web, so `peer.supported()` is false and `TransactionsScreen` is handed no
 * `onDevices`. This suite exists because the failure mode is silent and
 * embarrassing — a ⇄ button, in a browser, that opens a screen offering to
 * pair with devices it can never reach.
 *
 * Asserting on VISIBILITY rather than presence, as everything here does:
 * react-native-web leaves hidden Modals in the DOM, so a presence check is
 * not evidence of anything. See helpers.ts.
 */
import { expect, test } from '@playwright/test';
import { addTransaction, fresh } from './helpers';

test('the web build offers no pairing control', async ({ page }) => {
  await fresh(page);
  // The header is drawn — so this is a real absence, not a page that failed
  // to render at all.
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('add-button')).toBeVisible();
  await expect(page.getByTestId('devices-button')).toBeHidden();
  // The .00 setting is NOT device sync, so it stays on every surface.
  await expect(page.getByTestId('whole-toggle')).toBeVisible();
});

test('and no pairing screen behind it', async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId('devices-title')).toBeHidden();
  await expect(page.getByTestId('devices-code-input')).toBeHidden();
});

test('the ledger still works without any of it', async ({ page }) => {
  // The point of the whole no-op module design: a surface with no sync is a
  // working app, not a broken one.
  await fresh(page);
  await addTransaction(page, { name: 'Rent', amount: '-1450.' });
  await expect(page.getByTestId('total')).toHaveText('-$1,450.00');
});

test('the pairing code can be copied, not just retyped', async ({ page }) => {
  // Twenty-five characters is a lot to retype. The button is Apple-only like
  // the rest of pairing, so on the web there is nothing to press — and that
  // absence is the assertion.
  await fresh(page);
  await expect(page.getByTestId('devices-copy-code')).toBeHidden();
});
