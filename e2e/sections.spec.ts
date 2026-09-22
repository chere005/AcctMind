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

/** A long press — 350ms is the suite's one threshold (core's LONG_PRESS_MS). */
async function hold(page: Page, locator: ReturnType<Page['getByTestId']>) {
  const box = (await locator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
}


type Stored = {
  accounts: { id: string; name: string; color: string; deleted?: true }[];
  categories: { id: string; name: string; deleted?: true }[];
  lines: { id: string; name: string; category: string; budget: number; deleted?: true }[];
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

test('an account folds shut, and a HELD caret folds every one', async ({ page }) => {
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

  // The collapse-all button is gone (Sean, 2026-09-16, across the test suite):
  // holding any account's heading folds or unfolds every account, and which
  // way it goes is read off the heading that was held. So the same gesture
  // closes the ledger and opens it, with no button state to read first.
  const head = page.getByTestId(`account-head-${store.accounts[0]?.id}`);
  await expect(page.getByTestId('collapse-all'), 'the button is gone').toHaveCount(0);
  await hold(page, head);
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
  await hold(page, head);
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

test('the + beside a category adds a LINE, not a transaction', async ({ page }) => {
  // It used to open the add-transaction form with the category preset. Sean,
  // 2026-08-21: "the + in the budget section shouldn't add a transaction, it
  // adds a section to a category for budgeting a particular amount." So the
  // behaviour deliberately changed, and this test changed with it rather than
  // being deleted — what it guards is still the + doing the right thing.
  await page.goto('./');
  await expect(page.getByTestId('budget-title')).toBeVisible();

  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await page.getByTestId('manage-add').click();
  const store = await stored(page) as Stored;
  // slice(-1): a default category now exists on first run, so the one just
  // made in Manage is the LAST, not the first.
  const cat = store.categories.filter((c) => c.deleted !== true).slice(-1)[0];
  await page.getByTestId(`manage-name-${cat?.id}`).fill('Groceries');
  await page.getByTestId('manage-done').click();

  await page.getByTestId(`category-add-${cat?.id}`).click();
  // A LINE, not a transaction — and no modal of any kind. The + used to open
  // a line editor; since 2026-09-15 it just makes the row, and the
  // transaction form must still not be what appears.
  await expect(page.getByTestId('save-button')).toBeHidden();

  const after = await stored(page) as Stored;
  const line = after.lines.filter((l) => l.deleted !== true).slice(-1)[0];
  expect(line?.name).toBe('New line');
  expect(line?.category).toBe(cat?.id);
  // Filed under the category whose + was pressed — the only thing that press
  // knows, and the only thing it must not get wrong.
  expect(line?.category).toBe(cat?.id);
  // A new line starts at nothing budgeted. The + used to open an editor that
  // asked for a name and an amount before the row existed; since 2026-09-15
  // it makes the row first and both are set in place afterwards.
  expect(line?.budget).toBe(0);
  // And no transaction was made.
  expect(after.txns).toHaveLength(0);
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

test('everything on an account heading is the SAME distance from its neighbour', async ({ page }) => {
  /*
   * Sean, 2026-09-21: "even out the horizontal spacing here", over a shot of
   * a heading reading `● Account $1,136.98 ⚒ CLEARED/$391.23 ⚒`.
   *
   * Measured, because the eye was right and reading the stylesheet was not:
   * the margins said 6 and 6 either side of the total, but a hammer draws 6
   * points of whitespace INSIDE its own 26pt tap box, so the gap a person
   * saw there was 12 against 6 everywhere else. Only the rendered boxes know
   * that, which is why this is a gesture test and not a unit one.
   *
   * The GLYPHS, not the pressables: the tap target is deliberately bigger
   * than the mark in it, and asserting on the target would measure the very
   * thing that made the line look crooked.
   */
  await fresh(page);
  await addTransaction(page, { name: 'Rent', amount: '-1136.98' });

  const ink = async (sel: string) => {
    const box = await page.locator(sel).first().boundingBox();
    expect(box, `nothing to measure at ${sel}`).not.toBeNull();
    return box as NonNullable<typeof box>;
  };
  const dot = await ink('[data-testid^="account-head-"] svg');
  const name = await ink('[data-testid^="account-head-"] >> text="Account"');
  const total = await ink('[data-testid^="account-total-"]');
  const hammer = await ink('[data-testid^="account-reconcile-"]:not([data-testid*="cleared"]) svg');
  const cleared = await ink('[data-testid^="account-cleared-"]');
  const clearedHammer = await ink('[data-testid^="account-reconcile-cleared-"] svg');

  const between = (left: typeof dot, right: typeof dot) => right.x - (left.x + left.width);
  const gaps = [
    between(dot, name),
    between(name, total),
    between(total, hammer),
    between(hammer, cleared),
    between(cleared, clearedHammer),
  ];

  // All five the same, and the same as the app's one step. Sub-pixel slack
  // only: these are laid out in points and read back in CSS pixels.
  for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
});

test('a wide balance keeps ONE line, and the name is what gives', async ({ page }) => {
  /*
   * Found while evening out the gaps above, at the numbers that make the
   * heading tight: two figures over a thousand and both negative. The total
   * broke after its minus sign and drew `-` above `$1,528.21` inside a head
   * one line tall, so the sign sat on top of the amount.
   *
   * The cause was that the figure could SHRINK. Only `headName` is supposed
   * to — a name is the one thing here that can lose characters and still say
   * what it says — but with both shrinking, the row spent its shortfall on
   * the amount as well, and truncating money is not a saving.
   */
  await fresh(page);
  await addTransaction(page, { name: 'Rent', amount: '-152821' });
  await addTransaction(page, { name: 'Card', amount: '-113698' });
  // One of them CLEARED, and that is not decoration: it is what puts a
  // ten-character figure in the right-hand column instead of `$0.00`, and
  // the row is only short of room with both of them wide. Written without
  // this first, and it passed with the bug put back.
  await page.getByTestId(/^txn-cleared-/).first().click();
  await expect(page.locator('[data-testid^="account-cleared-"]')).toContainText('$1,');

  const total = page.locator('[data-testid^="account-total-"]');
  await expect(total).toHaveText('-$2,665.19');

  /*
   * The figure's own width, laid out with nothing to push against, against
   * the width it was actually given. NOT `scrollWidth > clientWidth`:
   * react-native-web CLAMPS a single-line Text, so those two stay equal
   * whether or not anything was lost — see "A check that was DELETED" in
   * TESTING.md, which is this same measurement getting it wrong once already.
   */
  const { drawn, wanted, height } = await total.evaluate((el) => {
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.style.position = 'fixed';
    ghost.style.left = '-9999px';
    ghost.style.width = 'auto';
    ghost.style.maxWidth = 'none';
    ghost.style.whiteSpace = 'pre';
    document.body.appendChild(ghost);
    const w = ghost.getBoundingClientRect().width;
    ghost.remove();
    const r = el.getBoundingClientRect();
    return { drawn: r.width, wanted: w, height: r.height };
  });

  // One line. A wrap is what a second line costs and it is what a person
  // sees: the minus sign drew ABOVE the amount, in a head one line tall.
  expect(height).toBeLessThan(24);
  // And all of it: the row's shortfall is spent on the NAME, never on money.
  expect(drawn).toBeGreaterThanOrEqual(wanted - 0.5);
});
