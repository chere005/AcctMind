/**
 * Shared driving for the gesture suite.
 *
 * **Assert on VISIBILITY, never on presence.** `react-native-web` renders a
 * hidden `Modal` into the DOM and leaves it there, so
 * `querySelector('[data-testid="save-button"]')` finds the add form long
 * after it has closed. A presence check therefore reports "still open"
 * forever — it passes with the bug present and with it absent, which is the
 * worst kind of check. Playwright's `toBeVisible()` reads computed style and
 * gets this right; that is why everything below goes through it.
 */
import { expect, type Page } from '@playwright/test';

export const KEY = 'acctmind.store.v1';

/**
 * Open the app on a device with nothing saved, on the Transactions tab.
 *
 * Budget is the FIRST tab now, so every test that is about transactions has
 * to say so. Doing it here rather than in each spec means the day a third tab
 * arrives, one line moves.
 */
export async function fresh(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByTestId('tab-transactions').click();
  await expect(page.getByTestId('title')).toBeVisible();
}

/** Open the app with a store already on the device. Seeded BEFORE first paint. */
export async function withStore(page: Page, raw: string): Promise<void> {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k as string, v as string),
    [KEY, raw] as const,
  );
  await page.goto('./');
  // A damaged store shows no tabs at all, so this is speculative and gets its
  // own short timeout — a click on a control that has gone waits out the whole
  // test budget and reads as a hang.
  await page.getByTestId('tab-transactions').click({ timeout: 1500 }).catch(() => {});
}

/**
 * Fill the add form and save. Leaves the date alone unless one is given.
 *
 * A leading `-` on `amount` means the − BUTTON, not a keystroke. Sean,
 * 2026-08-21: the field takes digits only, so typing a minus into it does
 * nothing at all — every caller here that wanted a negative used to get one
 * by putting a `-` in the string, and every caller that wanted a positive got
 * one because `fill()` REPLACED the default sign that a person's typing would
 * have left in place. Both were accidents of the driver.
 *
 * The sign is set by reading the form's own preview rather than by counting
 * on the default: the app says what sign it is currently on, and this presses
 * the button when that disagrees. A helper that assumed "new transactions
 * open negative" would go quietly wrong the day that default moved, and it
 * would go wrong in every test at once.
 */
export async function addTransaction(
  page: Page,
  fields: { name: string; description?: string; amount: string; day?: string },
): Promise<void> {
  await page.getByTestId('add-button').click();
  await expect(page.getByTestId('save-button')).toBeVisible();

  await page.getByTestId('name-input').fill(fields.name);
  if (fields.description !== undefined) {
    await page.getByTestId('description-input').fill(fields.description);
  }
  await page.getByTestId('amount-input').fill(fields.amount.replace('-', ''));
  await setSign(page, fields.amount.trimStart().startsWith('-'));

  if (fields.day !== undefined) await pickDay(page, fields.day);

  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();
}

/**
 * Put the add form's − button into a known state, by asking the form.
 *
 * `accessibilityState={{ checked }}` does not reach the DOM as `aria-checked`
 * under react-native-web — the toggle's only tell is a class name, which is
 * not something to assert on. The PREVIEW is the app's own statement of the
 * sign, so that is what gets read.
 */
export async function setSign(page: Page, negative: boolean): Promise<void> {
  const shown = (await page.getByTestId('amount-preview').textContent()) ?? '';
  // LOUD when it cannot tell, rather than silently leaving the sign alone.
  // An empty preview means no amount has been typed yet, and there is nothing
  // to read the sign from — at which point "no click needed" and "no idea"
  // look identical, which is how a guard ends up passing while doing nothing.
  expect(shown, 'set the amount before the sign — the preview is what says which way it points')
    .not.toBe('');
  if (shown.startsWith('-') !== negative) await page.getByTestId('sign-toggle').click();
}

/** Choose a sort order from the dropdown in the bar. */
export async function pickSort(page: Page, mode: 'custom' | 'date' | 'amount'): Promise<void> {
  await page.getByTestId('sort-pick').click();
  await page.getByTestId(`sort-${mode}`).click();
  // The menu is a Modal, and react-native-web leaves a hidden one in the DOM
  // — so this waits on VISIBILITY, never on presence. A presence check here
  // would pass with the menu stuck open and with it closed.
  await expect(page.getByTestId('sort-menu-backdrop')).toBeHidden();
}

/** Walk the month grid to a day and tap it. */
export async function pickDay(page: Page, day: string): Promise<void> {
  await page.getByTestId('date-button').click();
  await expect(page.getByTestId('month-label')).toBeVisible();

  // Step month by month rather than jumping, because stepping is what a
  // person does and the arrows are what would break.
  for (let i = 0; i < 24; i++) {
    const cell = page.getByTestId(`day-${day}`);
    if (await cell.isVisible()) { await cell.click(); return; }
    const shown = await page.getByTestId('month-label').innerText();
    await page.getByTestId(monthIsAfter(shown, day) ? 'month-prev' : 'month-next').click();
  }
  throw new Error(`never found ${day} in the grid`);
}

/** Is the displayed month later than the day we are looking for? */
function monthIsAfter(label: string, day: string): boolean {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                 'August', 'September', 'October', 'November', 'December'];
  const [name, year] = label.split(' ') as [string, string];
  const shown = Number(year) * 12 + names.indexOf(name);
  const want = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
  return shown > want;
}

/**
 * The transactions the device actually has saved.
 *
 * Separate from `stored` because a fresh device is no longer empty: it writes
 * one account before anything is drawn, so "nothing was added" is a claim
 * about the TRANSACTIONS, not about the file.
 */
export async function storedTxns(page: Page): Promise<unknown[]> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), KEY);
  if (raw === null) return [];
  const parsed = JSON.parse(raw) as { txns?: unknown[] };
  return parsed.txns ?? [];
}

/** What the device actually has saved. The screen is not the evidence. */
export async function stored(page: Page): Promise<unknown> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), KEY);
  return raw === null ? null : JSON.parse(raw);
}

/** Every row, top to bottom, as { name, amount, date }. */
export async function rows(page: Page) {
  return page.getByTestId('txn-row').evaluateAll((els) =>
    els.map((el) => ({
      name: el.querySelector('[data-testid="txn-name"]')?.textContent ?? '',
      description: el.querySelector('[data-testid="txn-description"]')?.textContent ?? '',
      amount: el.querySelector('[data-testid="txn-amount"]')?.textContent ?? '',
      date: el.querySelector('[data-testid="txn-date"]')?.textContent ?? '',
    })));
}

/**
 * Reload and come back to Transactions.
 *
 * The app opens on Budget every time, by design — so a reload in the middle
 * of a transactions test lands somewhere else, and asserting on rows there
 * fails for a reason that has nothing to do with what is being tested.
 */
export async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.getByTestId('tab-transactions').click();
  await expect(page.getByTestId('title')).toBeVisible();
}

/**
 * Swipe a row left, with REAL touch events.
 *
 * Three earlier attempts drove this with `page.mouse` and every one of them
 * passed while doing NOTHING: react-native-web's PanResponder never engaged,
 * so a 220-pixel drag deleted nothing and the test could not fail. Two of
 * those were deleted rather than kept green, and the swipe went untested at
 * this level for that reason.
 *
 * What works is `Input.dispatchTouchEvent` over CDP — a genuine touch stream
 * the responder system does pick up. It is CHROMIUM ONLY (the mobile project
 * is WebKit, which has no CDP), so every caller skips elsewhere; the rules
 * themselves are core's and run everywhere without a finger.
 *
 * The moves are stepped rather than jumped because the responder decides
 * mid-gesture: one leap from start to end is a single event and reads as a
 * teleport, not a drag. Proven honest by driving it 60px — short of
 * SWIPE_ARM_PX — and watching nothing arm.
 */
export async function swipeRow(page: Page, index: number, dx: number): Promise<void> {
  const box = (await page.getByTestId('txn-row-body').nth(index).boundingBox())!;
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width - 20;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / steps, y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
