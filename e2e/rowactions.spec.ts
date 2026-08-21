/**
 * Edit mode: the pencil, then edit, duplicate, copy, delete on every row.
 *
 * It used to be a HOLD on one row. Sean, 2026-08-21: "put a pencil icon
 * button at the top for edit mode... no more holding or double tapping for
 * edit mode or having to exit edit mode in this app." A hold is a mode you
 * can enter by accident, on a gesture with no affordance, and it was also the
 * gesture the swipe kept stealing.
 *
 * Every assertion here checks the DEVICE as well as the screen where the
 * ledger changed. A row that vanishes from a list and survives in storage is
 * the shape of bug this project cares about most — and for delete it is the
 * likely one, because a delete has to persist as a tombstone rather than as
 * an absence.
 */
import { expect, test, type Page } from '@playwright/test';
import { addTransaction, fresh, pickSort, reload, rows, stored } from './helpers';

type Stored = { txns: { id: string; name: string; amount: number; deleted?: true }[] };

/**
 * Turn edit mode on from the pencil in the top bar.
 *
 * Named `hold` no longer — there is no hold. Every row shows its controls at
 * once, so the index a caller used to pass is gone with it.
 */
async function edit(page: Page): Promise<void> {
  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('row-actions').first()).toBeVisible();
}

test('a held row offers the four actions, delete furthest right', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await edit(page);

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

test('delete leaves a tombstone, not an absence', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await edit(page);
  await page.getByTestId('row-delete').first().click();

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
  await edit(page);
  await page.getByTestId('row-delete').first().click();
  await expect(page.getByTestId('txn-row')).toHaveCount(0);

  await reload(page);
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
});

test('duplicate makes a second, separate transaction', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await edit(page);
  await page.getByTestId('row-duplicate').first().click();

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

  await edit(page);
  await page.getByTestId('row-edit').first().click();
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
  await edit(page);
  await page.getByTestId('row-edit').first().click();
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

  await edit(page);
  await page.getByTestId('row-edit').first().click();
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
  await edit(page);
  await page.getByTestId('row-edit').first().click();
  await page.getByTestId('cancel-button').click();

  await addTransaction(page, { name: 'Tea', amount: '300' });
  await expect(page.getByTestId('txn-row')).toHaveCount(2);
});

test('the drag grip is offered in custom order, and only there', async ({ page }) => {
  // Moving a row is a DRAG on the grip now — Sean, 2026-08-21, matching
  // CalMind. That gesture cannot be driven from here: react-native-web's
  // PanResponder does not engage under Playwright's synthetic mouse, which is
  // exactly why two swipe tests were deleted rather than kept green. So this
  // asserts the part that IS observable — whether the handle is offered — and
  // the arithmetic that turns a finger into a destination lives in core's
  // `reorder`, which has its own tests.
  //
  // OPACITY, not visibility: the grip is always in the tree and always laid
  // out, because a handle that appears and disappears slides every name in
  // the ledger sideways the moment the sort changes. Playwright's
  // `toBeVisible()` does not read opacity, so it cannot tell the two states
  // apart — the computed style can.
  await fresh(page);
  await addTransaction(page, { name: 'first', amount: '100', day: '2026-08-20' });
  await addTransaction(page, { name: 'second', amount: '200', day: '2026-08-19' });

  const gripOpacity = () => page.getByTestId('row-grip').first()
    .evaluate((el) => getComputedStyle(el).opacity);

  // Not in edit mode: no handle, whatever the sort. Dragging is an editing
  // gesture and lives behind the pencil with the rest of them.
  await pickSort(page, 'custom');
  expect(await gripOpacity()).toBe('0');

  await edit(page);
  expect(await gripOpacity()).toBe('1');

  // And still gated on the ORDER: a row moved by hand in date order would be
  // put back by the next render, which reads as the app ignoring you.
  await page.getByTestId('edit-toggle').click();
  await pickSort(page, 'amount');
  await edit(page);
  expect(await gripOpacity()).toBe('0');
});

test('the grip keeps its space, so entering edit mode moves nothing', async ({ page }) => {
  // The reason the grip is hidden by opacity rather than by being absent.
  // Measured, because "it does not shift" is a claim about geometry and
  // nothing else in the suite would notice a four-pixel jump.
  await fresh(page);
  await addTransaction(page, { name: 'first', amount: '100', day: '2026-08-20' });
  await addTransaction(page, { name: 'second', amount: '200', day: '2026-08-19' });
  await pickSort(page, 'custom');

  const nameX = async () => {
    const box = await page.getByTestId('txn-name').first().boundingBox();
    return box?.x ?? -1;
  };
  const before = await nameX();
  await edit(page);
  expect(await nameX()).toBe(before);
});

test('the date and amount chips each sort by what they say', async ({ page }) => {
  // The sorting RULES are pinned in core by spec/sortmodes.json. What that
  // leaves unproven is the WIRING — three chips, three modes — and nothing
  // checked it: `sort-date` and `sort-amount` were asserted nowhere, so the
  // middle chip could have passed 'custom' and every suite would have stayed
  // green. Core being right does not make the screen right.
  await fresh(page);
  // Chosen so no two modes agree. The largest amount is on the OLDEST row and
  // the second largest is NEGATIVE, so a fixture-shaped mistake — the two
  // chips swapped, or absolute value dropped — changes the answer here.
  await addTransaction(page, { name: 'alpha', amount: '900', day: '2026-08-18' });
  await addTransaction(page, { name: 'bravo', amount: '100', day: '2026-08-20' });
  await addTransaction(page, { name: 'charlie', amount: '-500', day: '2026-08-19' });

  await pickSort(page, 'date');
  expect(await page.getByTestId('txn-name').allTextContents())
    .toEqual(['bravo', 'charlie', 'alpha']);

  await pickSort(page, 'amount');
  // -$5.00 above $1.00: the question the chip answers is how BIG the amount
  // was, not which way the money went.
  expect(await page.getByTestId('txn-name').allTextContents())
    .toEqual(['alpha', 'charlie', 'bravo']);
});

test('opening a row moves nothing, and stays inside the row', async ({ page }) => {
  // Sean, 2026-08-21: "things shouldn't shift around when entering edit mode."
  //
  // TWO claims here, and only the second catches the bug that prompted it.
  // The cluster was already absolutely positioned, so nothing REFLOWED — but
  // each button carried `minHeight: 44` inside a row that had shrunk to 36,
  // so the buttons overflowed their own row and hung over the neighbours.
  //
  // The first version of this test measured the rows before and after and
  // PASSED with the 44 put back, because an absolutely-positioned child that
  // overflows does not change its container's rect. It was watched failing at
  // nothing, which is the only reason it is written this way now. What
  // separates the two states is CONTAINMENT: where the buttons are, relative
  // to the row they belong to.
  await fresh(page);
  await addTransaction(page, { name: 'first', amount: '100', day: '2026-08-20' });
  await addTransaction(page, { name: 'second', amount: '200', day: '2026-08-19' });

  const boxes = async () => page.getByTestId('txn-row').evaluateAll((els) =>
    els.map((el) => { const r = el.getBoundingClientRect(); return { y: r.y, h: r.height }; }));

  const before = await boxes();
  await edit(page);
  await expect(page.getByTestId('row-actions').first()).toBeVisible();

  // Nothing reflowed…
  expect(await boxes()).toEqual(before);

  // …and every control sits inside the row it acts on, so none of them is
  // hanging over the row above or below.
  const row = await page.getByTestId('txn-row').first().boundingBox();
  for (const id of ['row-edit', 'row-duplicate', 'row-copy', 'row-delete']) {
    const btn = await page.getByTestId(id).first().boundingBox();
    expect(btn, id).not.toBeNull();
    expect(btn!.y, `${id} top`).toBeGreaterThanOrEqual(row!.y - 0.5);
    expect(btn!.y + btn!.height, `${id} bottom`)
      .toBeLessThanOrEqual(row!.y + row!.height + 0.5);
  }
});

test('the action cluster hides what it covers, and leaves the name alone', async ({ page }) => {
  // TWO things, both of which read as "things shifted" when they were wrong.
  //
  // It was `T.bg + 'ee'` across the FULL width of the row, so opening a row
  // blanked the whole thing — name and amount gone, four labelled buttons
  // where a transaction had been. Now the cluster is pinned right, only as
  // wide as its buttons, and fully opaque.
  //
  // Visibility cannot tell those apart: the cluster is visible either way and
  // so is the row. The computed background is the only difference, which is
  // the same shape of check the transparent-row bug needed.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await edit(page);
  const bg = await page.getByTestId('row-action-cluster').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  // No alpha channel: `rgba(…, 0.93)` would be the old translucent one back.
  expect(bg).toMatch(/^rgb\(/);

  // And it does not span the row. Measured against the ROW, not against the
  // name: `txn-name` is a flex child that stretches to fill the space, so its
  // box is the whole left side of the row however short the word in it is —
  // comparing against that box proves nothing about what is covered.
  const row = await page.getByTestId('txn-row').first().boundingBox();
  const cluster = await page.getByTestId('row-action-cluster').first().boundingBox();
  expect(cluster!.x).toBeGreaterThan(row!.x + row!.width * 0.3);
});

test('a row paints its own background, so a lifted row is not see-through', async ({ page }) => {
  // Originally written for the swipe's red delete backdrop, which showed
  // through every row because the row had no background of its own — the
  // whole ledger drew solid red under its own text. That backdrop is gone
  // (the swipe parks a button now and destroys nothing), but the rule it
  // taught still holds: a row RIDES OVER its neighbours while it is being
  // dragged, and a transparent one would print itself on top of them.
  //
  // As before, this cannot be a visibility check — the row is visible whether
  // or not it paints. Only the computed style separates the two.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  const bg = await page.getByTestId('txn-row-body').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
});

test('the pencil turns edit mode off again, and choosing an action does too', async ({ page }) => {
  // "no more... having to exit edit mode": picking anything ends it, so
  // nobody is left in a mode they have to notice and undo. The pencil is
  // still a toggle for the case where you changed your mind.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });

  await edit(page);
  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('row-actions').first()).toBeHidden();

  await edit(page);
  await page.getByTestId('row-copy').first().click();
  // Copy changes nothing about the ledger, so what is being watched here is
  // only that the mode ended.
  await expect(page.getByTestId('row-actions').first()).toBeHidden();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);
});

test('every row shows its controls at once, not just the one you touched', async ({ page }) => {
  // The substance of the change: it is a PAGE mode now, not a row that was
  // held. With one row at a time, reordering or deleting three things meant
  // three separate holds.
  await fresh(page);
  await addTransaction(page, { name: 'first', amount: '100', day: '2026-08-20' });
  await addTransaction(page, { name: 'second', amount: '200', day: '2026-08-19' });
  await edit(page);
  await expect(page.getByTestId('row-actions')).toHaveCount(2);
});

test('nothing offers actions until the pencil is pressed', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '450' });
  await expect(page.getByTestId('row-actions')).toHaveCount(0);
  // And a hold does nothing at all now — the gesture is gone.
  const box = await page.getByTestId('txn-row-body').first().boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByTestId('row-actions')).toHaveCount(0);
});

/*
 * The swipe is NOT driven from here.
 *
 * Three attempts were: react-native-web's pan responder does not engage under
 * Playwright's mouse, so a 220-pixel drag deleted nothing — which meant the
 * "a half-swipe does not delete" and "the swipe does not steal a long press"
 * tests passed because NOTHING HAPPENED. A check that cannot fail looks
 * exactly like one that passes, and two of those were about to be committed.
 *
 * Both thresholds and both decisions are rules stated in a sentence, so they
 * are core's — `claimsSwipe` and `swipeDeletes`, with the six-pixel drift
 * that shipped broken as a named case. They run everywhere and need no
 * finger. What is left unproven here is only that the handler CALLS them.
 */

test('rows are picked out in edit mode, and the bar says what they come to', async ({ page }) => {
  // Sean, 2026-08-21: "in edit mode allow for selecting multiple
  // transactions.. when multiple transactions are selected, show the sum of
  // their amounts." Which is the point of it — "what did this weekend cost"
  // should be four taps, not four numbers added by hand.
  await fresh(page);
  await addTransaction(page, { name: 'a', amount: '-450', day: '2026-08-20' });
  await addTransaction(page, { name: 'b', amount: '-1250', day: '2026-08-19' });
  await addTransaction(page, { name: 'c', amount: '2400', day: '2026-08-18' });

  // Nothing selected: the running total, as before.
  // -4.50 + -12.50 + 24.00
  await expect(page.getByTestId('total')).toHaveText('$7.00');
  await edit(page);
  await expect(page.getByTestId('picked-total')).toHaveCount(0);

  await page.getByTestId('txn-row-body').nth(0).click();
  await expect(page.getByTestId('picked-total')).toContainText('1 selected');
  await expect(page.getByTestId('picked-total')).toContainText('-$4.50');

  await page.getByTestId('txn-row-body').nth(1).click();
  await expect(page.getByTestId('picked-total')).toContainText('2 selected');
  await expect(page.getByTestId('picked-total')).toContainText('-$17.00');

  // Tapping again puts a row back, and the sum follows.
  await page.getByTestId('txn-row-body').nth(0).click();
  await expect(page.getByTestId('picked-total')).toContainText('1 selected');
  await expect(page.getByTestId('picked-total')).toContainText('-$12.50');
});

test('leaving edit mode clears the selection', async ({ page }) => {
  // A selection you cannot see is one that will surprise you the next time
  // the pencil is pressed.
  await fresh(page);
  await addTransaction(page, { name: 'a', amount: '-450' });
  await edit(page);
  await page.getByTestId('txn-row-body').first().click();
  await expect(page.getByTestId('picked-total')).toBeVisible();

  await page.getByTestId('edit-toggle').click();
  await expect(page.getByTestId('total')).toBeVisible();
  await edit(page);
  await expect(page.getByTestId('picked-total')).toHaveCount(0);
});

test('a tap outside edit mode picks nothing', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'a', amount: '-450' });
  await page.getByTestId('txn-row-body').first().click();
  await expect(page.getByTestId('picked-total')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText('-$4.50');
});

test('a tap on the name edits it in place, and the row does not move', async ({ page }) => {
  // Sean, 2026-08-21: "a single tap on a transaction's name, amount, or date
  // should start editing in place." The common change — a typo, a wrong
  // figure — is one tap now, and the form is for when you want the whole
  // record.
  await fresh(page);
  await addTransaction(page, { name: 'Cofee', amount: '-450' });

  const rowBox = async () => page.getByTestId('txn-row').first().boundingBox();
  const before = await rowBox();

  await page.getByTestId('txn-name-tap').click();
  await expect(page.getByTestId('txn-name-input')).toBeVisible();
  // The field wears the text's own type and no padding, so swapping one for
  // the other changes no measurement. An inline edit that nudges the row is
  // worse than a screen: the thing you were aiming at moves as you touch it.
  const during = await rowBox();
  expect(during!.height).toBe(before!.height);

  await page.getByTestId('txn-name-input').fill('Coffee');
  await page.getByTestId('txn-name-input').press('Enter');
  await expect(page.getByTestId('txn-name')).toHaveText('Coffee');

  // On the RECORD, not just on screen.
  const s = await stored(page) as Stored;
  expect(s.txns.find((t) => t.deleted !== true)?.name).toBe('Coffee');
});

test('a tap on the amount edits it in place, under the same entry rules', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });

  await page.getByTestId('txn-amount-tap').click();
  await expect(page.getByTestId('txn-amount-input')).toBeVisible();
  // Seeded with the canonical string, so it reads the same under either
  // entry mode — the same pair the add form uses.
  await expect(page.getByTestId('txn-amount-input')).toHaveValue('-4.50');

  await page.getByTestId('txn-amount-input').fill('-1275');
  await page.getByTestId('txn-amount-input').press('Enter');
  await expect(page.getByTestId('txn-amount')).toHaveText('-$12.75');
  await expect(page.getByTestId('total')).toHaveText('-$12.75');
});

test('an unreadable amount commits nothing rather than writing a zero', async ({ page }) => {
  // The refusal money.ts exists for, one level up: 1.005 could be 100 cents
  // or 101 and this app picks neither.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await page.getByTestId('txn-amount-tap').click();
  await page.getByTestId('txn-amount-input').fill('1.005');
  await page.getByTestId('txn-amount-input').press('Enter');
  await expect(page.getByTestId('txn-amount')).toHaveText('-$4.50');
});

test('an emptied name commits nothing — a nameless row is not an edit', async ({ page }) => {
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await page.getByTestId('txn-name-tap').click();
  await page.getByTestId('txn-name-input').fill('   ');
  await page.getByTestId('txn-name-input').press('Enter');
  await expect(page.getByTestId('txn-name')).toHaveText('Coffee');
});

test('in edit mode a tap picks the row instead of editing a field', async ({ page }) => {
  // What a tap does depends on the mode and only on the mode. Both behaviours
  // on one gesture would make every selection a coin toss.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await edit(page);
  await page.getByTestId('txn-name-tap').click();
  await expect(page.getByTestId('txn-name-input')).toHaveCount(0);
  await expect(page.getByTestId('picked-total')).toContainText('1 selected');
});

test('the inline amount has a − beside it, and pressing it does not commit', async ({ page }) => {
  // Sean, 2026-08-21. The sign is the thing most often wrong about an amount
  // — a payment typed as income is wrong by twice its own size — and reaching
  // for the keyboard's minus to fix it is a worse gesture than a button that
  // is already there.
  //
  // The trap it hides: pressing the button BLURS the field, and blur is what
  // commits. Without a guard the editor closed and wrote the old value before
  // the flip applied, so the button appeared to do nothing at all.
  await fresh(page);
  await addTransaction(page, { name: 'Refund', amount: '-450' });

  await page.getByTestId('txn-amount-tap').click();
  await expect(page.getByTestId('txn-amount-input')).toHaveValue('-4.50');

  await page.getByTestId('txn-amount-sign').click();
  // Still open — the press must not have committed — and the sign has flipped.
  await expect(page.getByTestId('txn-amount-input')).toBeVisible();
  await expect(page.getByTestId('txn-amount-input')).toHaveValue('4.50');

  await page.getByTestId('txn-amount-input').press('Enter');
  await expect(page.getByTestId('txn-amount')).toHaveText('$4.50');
  await expect(page.getByTestId('total')).toHaveText('$4.50');
});

test('and flipping it back leaves the row where it started', async ({ page }) => {
  // Two presses is a no-op, which is only true if the button reads the TEXT
  // rather than keeping a sign of its own.
  await fresh(page);
  await addTransaction(page, { name: 'Coffee', amount: '-450' });
  await page.getByTestId('txn-amount-tap').click();
  await page.getByTestId('txn-amount-sign').click();
  await page.getByTestId('txn-amount-sign').click();
  await page.getByTestId('txn-amount-input').press('Enter');
  await expect(page.getByTestId('txn-amount')).toHaveText('-$4.50');
});
