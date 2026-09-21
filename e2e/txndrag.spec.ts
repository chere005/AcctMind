/**
 * Dragging a transaction into ANOTHER ACCOUNT.
 *
 * The ledger's half of Sean's 2026-09-21 ask — "anywhere that has folders and
 * sections and dragging items". An account is this screen's section, and
 * until today each one owned its own drag over its own rows, so a row could
 * be reordered but never re-filed. The screen runs ONE drag over every drawn
 * entry now, and core's `rowslots.ts` — the bytes CoreMind canon and three
 * sibling apps carry — turns the boundary a finger lands on into an account
 * and a neighbour.
 *
 * The rules underneath are unit-tested (`rowslots.test.ts`, `moveTxnTo` in
 * `txn.test.ts`). What only this level can say is that the screen hands them
 * the list it actually DREW — the whole class of bug here is an index that
 * means one thing to the measurer and another to the rule.
 *
 * CHROMIUM ONLY: `dragGrip` needs CDP touch events, because
 * react-native-web's PanResponder ignores a synthetic mouse and a mouse
 * "drag" would pass while doing nothing at all. See `swipeRow`.
 */
import { expect, test, type Page } from '@playwright/test';
import { dragGrip, pickSort, stored, withStore } from './helpers';

type Stored = { txns: { id: string; name: string; account: string; order: number }[] };

/**
 * Two accounts with two rows each, and an empty one BETWEEN them — the
 * placement that matters: an empty account at the end of the list is
 * reachable by the "past the last entry" rule whatever else is true, so it
 * would prove nothing.
 */
const STORE = JSON.stringify({
  v: 4,
  accounts: [
    { id: 'A', name: 'Checking', color: '#4c8bf0', order: 0, created: 1, updated: 1 },
    { id: 'C', name: 'Cash', color: '#f0b429', order: 1, created: 1, updated: 1 },
    { id: 'B', name: 'Savings', color: '#66d695', order: 2, created: 1, updated: 1 },
  ],
  categories: [], lines: [], views: [], budgets: [],
  txns: [
    { id: 'a1', name: 'Coffee', description: '', amount: -450, date: '2026-08-20', account: 'A', category: null, order: 40, created: 1, updated: 1 },
    { id: 'a2', name: 'Lunch', description: '', amount: -1250, date: '2026-08-19', account: 'A', category: null, order: 30, created: 2, updated: 2 },
    { id: 'b1', name: 'Interest', description: '', amount: 100, date: '2026-08-18', account: 'B', category: null, order: 20, created: 3, updated: 3 },
    { id: 'b2', name: 'Deposit', description: '', amount: 5000, date: '2026-08-17', account: 'B', category: null, order: 10, created: 4, updated: 4 },
  ],
});

const txnOf = async (page: Page, id: string) =>
  ((await stored(page)) as Stored).txns.find((t) => t.id === id)!;

/**
 * Open the ledger in edit mode, in CUSTOM order — the only order a grip is
 * offered in, because a hand order the next render would undo is worse than
 * none.
 */
async function ledgerEdit(page: Page): Promise<void> {
  await withStore(page, STORE);
  await expect(page.getByTestId('title')).toBeVisible();
  await pickSort(page, 'custom');
  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('row-actions').first()).toBeVisible();
}

/** The grip of the row with this name. Rows are keyed by name on screen. */
const gripOf = (page: Page, name: string) =>
  page.getByTestId('txn-row').filter({ hasText: name }).first().getByTestId('row-grip');
const rowOf = (page: Page, name: string) =>
  page.getByTestId('txn-row').filter({ hasText: name }).first();

test.describe('dragging a transaction between accounts', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch events');

  test('a row dropped on another account JOINS it', async ({ page }) => {
    await ledgerEdit(page);
    await dragGrip(page, gripOf(page, 'Coffee'), rowOf(page, 'Interest'), -8);

    const moved = await txnOf(page, 'a1');
    expect(moved.account, 'the row changed account').toBe('B');
    // Nothing else about it moved: an account is where a row is KEPT, not
    // what it is.
    expect(moved.name).toBe('Coffee');
    // The ledger sorts DESCENDING — a bigger order draws higher (sortTxns) —
    // so landing above Savings' first row means a bigger number, not a
    // smaller one. Budget lines run the other way; see OrderDir in core.
    expect(moved.order).toBeGreaterThan((await txnOf(page, 'b1')).order);
  });

  test('the account it LEFT no longer holds it, and the totals follow', async ({ page }) => {
    await ledgerEdit(page);
    await dragGrip(page, gripOf(page, 'Coffee'), rowOf(page, 'Deposit'), 8);

    const after = (await stored(page)) as Stored;
    expect(after.txns.filter((t) => t.account === 'A').map((t) => t.id)).toEqual(['a2']);
    // -$12.50 left in Checking; $1.00 + $50.00 − $4.50 in Savings.
    await expect(page.getByTestId('account-total-A')).toHaveText('-$12.50');
    await expect(page.getByTestId('account-total-B')).toHaveText('$46.50');
  });

  test('a row dropped on an account with NOTHING in it lands there', async ({ page }) => {
    // An empty account is a heading and nothing else, and that is enough: a
    // drop below its heading is "the section above the next header", which
    // is this one. Cash sits BETWEEN the other two for this test, because
    // the last account in the list is reachable by the "past the last entry"
    // rule and so would prove nothing.
    await ledgerEdit(page);
    await dragGrip(page, gripOf(page, 'Coffee'), page.getByTestId('account-head-C'), 24);
    expect((await txnOf(page, 'a1')).account).toBe('C');
  });

  test('a row dropped just under a SHUT heading joins that account', async ({ page }) => {
    // The case with no rows to aim at. Until the heading became an entry of
    // its own, a folded account could not be dropped into at all.
    await ledgerEdit(page);
    await page.getByTestId('edit-toggle').click();
    await page.getByTestId('account-head-B').click();
    await expect(page.getByTestId('txn-row')).toHaveCount(2);
    await page.getByTestId('edit-toggle').click();

    // Clearly BELOW the heading's midpoint. Just above it is the end of the
    // account drawn above — which is a real answer, and the previous test's.
    await dragGrip(page, gripOf(page, 'Coffee'), page.getByTestId('account-head-B'), 24);
    expect((await txnOf(page, 'a1')).account).toBe('B');
  });

  test('a row dragged to the bottom of its OWN account stays in it', async ({ page }) => {
    // The boundary above the next account's heading. Without the heading in
    // the list it read as "the top of the next one", so a row reordered
    // within its own account silently left it.
    await ledgerEdit(page);
    await dragGrip(page, gripOf(page, 'Coffee'), rowOf(page, 'Lunch'), 8);

    const moved = await txnOf(page, 'a1');
    expect(moved.account).toBe('A');
    // Below Lunch, and DESCENDING means below is a smaller order.
    expect(moved.order).toBeLessThan((await txnOf(page, 'a2')).order);
  });

  test('no grip at all outside custom order, however many accounts there are', async ({ page }) => {
    // Unchanged, and worth pinning next to the new freedom: a hand-placed
    // row in a date-sorted list is a statement the next render undoes.
    await withStore(page, STORE);
    await pickSort(page, 'date');
    await page.getByTestId('edit-toggle').click();
    await expect(page.getByTestId('row-actions').first()).toBeVisible();
    await dragGrip(page, gripOf(page, 'Coffee'), rowOf(page, 'Interest'), -8);
    expect((await txnOf(page, 'a1')).account).toBe('A');
  });
});
