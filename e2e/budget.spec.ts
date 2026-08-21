/**
 * Changing a budget amount: the pad on the Budget page.
 *
 * Tapping either editable number opens a small card over the list rather than
 * a screen instead of it — Sean, 2026-08-21. The arithmetic itself is core's
 * — `applyOp`, `availableOf`, `budgetFor`, all replayed from
 * `spec/budget.json`. What is only checkable here is the WIRING: that `+` is
 * wired to plus, that the available field is wired to the inverse, that the
 * operator works from the value as it STOOD rather than compounding on every
 * keystroke, and that the list is still there behind the pad.
 */
import { expect, test, type Page } from '@playwright/test';
import { stored } from './helpers';

type Stored = {
  categories: { id: string; name: string; deleted?: true }[];
  lines: { id: string; name: string; category: string; budget: number; deleted?: true }[];
};

const liveLines = (s: Stored) => s.lines.filter((l) => l.deleted !== true);

/** A category with one line in it, budgeted at $250. Returns the line id. */
async function seed(page: Page): Promise<string> {
  await page.goto('./');
  await expect(page.getByTestId('budget-title')).toBeVisible();
  await page.getByTestId('section-pick').click();
  await page.getByTestId('section-manage').click();
  await page.getByTestId('manage-add').click();
  const s = await stored(page) as Stored;
  const cat = s.categories.filter((c) => c.deleted !== true)[0]?.id ?? '';
  await page.getByTestId(`manage-name-${cat}`).fill('Groceries');
  await page.getByTestId('manage-done').click();

  await page.getByTestId(`category-add-${cat}`).click();
  await expect(page.getByTestId('line-save')).toBeVisible();
  // CLICK before fill — under the mobile project a fill on a Modal's input
  // silently does nothing otherwise. See sections.spec.ts for the full note.
  await page.getByTestId('line-name').click();
  await page.getByTestId('line-name').fill('Produce');
  await page.getByTestId('line-budget').click();
  await page.getByTestId('line-budget').fill('250');
  await page.getByTestId('line-save').click();
  await expect(page.getByTestId('line-save')).toBeHidden();
  return liveLines(await stored(page) as Stored)[0]?.id ?? '';
}

/** Tap one of a line's editable numbers. Opens the box. */
async function tapAmount(page: Page, id: string, field: 'budgeted' | 'available'): Promise<void> {
  await page.getByTestId(`line-${field}-tap-${id}`).click();
  await expect(page.getByTestId('pad-amount')).toBeVisible();
}

/** Finish the edit with Return — one of the two ways out, and there is no Done. */
async function commit(page: Page): Promise<void> {
  await page.getByTestId('pad-amount').press('Enter');
  await expect(page.getByTestId('pad-amount')).toBeHidden();
}

test('the pad opens over the list, and the page is still READABLE behind it', async ({ page }) => {
  // Two goes at this. It was a full screen first — the wrong weight for a
  // two-second thought. Then it was a small card behind a `#00000088`
  // backdrop, which Sean rejected again: on a near-black app a 53%-black wash
  // makes everything behind it invisible, so the list you were reading to
  // decide the number was gone anyway.
  //
  // `toBeVisible()` could not tell those apart. Every row is still "visible"
  // under a wash — it is in the tree, laid out, non-zero. What separates a
  // readable page from a hidden one is whether the thing on top of it PAINTS,
  // so that is what this reads. Same shape as the transparent-row check.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');

  await expect(page.getByTestId(`line-row-${line}`)).toBeVisible();
  await expect(page.getByTestId('line-save')).toBeHidden();

  const wash = await page.getByTestId('pad-backdrop')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(wash === 'rgba(0, 0, 0, 0)' || wash === 'transparent').toBe(true);
});

test('the pad defaults to +', async ({ page }) => {
  // Adjusting is the common case — "twenty more for groceries" — and setting
  // is the one worth a deliberate tap.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount').fill('20');
  // 250 + 20, without ever choosing an operator.
  await expect(page.getByTestId('pad-amount-result')).toHaveText('$270.00');
});

test('= replaces the value', async ({ page }) => {
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('80');
  await commit(page);
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(8000);
});

test('+ adds to what is already there', async ({ page }) => {
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-add').click();
  await page.getByTestId('pad-amount').fill('20');
  await expect(page.getByTestId('pad-amount-result')).toHaveText('$270.00');
  await commit(page);
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(27000);
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$270.00');
});

test('− subtracts, and can take a line below zero', async ({ page }) => {
  // Not clamped at zero: -$50 is a true statement about an over-committed
  // line, and hiding it is the one thing a budget must not do.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-sub').click();
  await page.getByTestId('pad-amount').fill('300');
  await expect(page.getByTestId('pad-amount-result')).toHaveText('-$50.00');
  await commit(page);
  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(-5000);
});

test('the operator works from where the value STOOD, not from each keystroke', async ({ page }) => {
  // Typing 2 then 0 under `+` must give 250 + 20, not (250 + 2) + 20. The
  // base is captured when the operator is chosen, and every keystroke
  // recomputes from THAT — otherwise the answer depends on how fast you type.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-add').click();
  await page.getByTestId('pad-amount').pressSequentially('20', { delay: 40 });
  await expect(page.getByTestId('pad-amount-result')).toHaveText('$270.00');
});

test('editing AVAILABLE moves what is budgeted, and the two agree', async ({ page }) => {
  // One stored number and two views of it. Asking for $300 available on a
  // line with nothing spent means budgeting $300; the pair can never
  // disagree, because only one of them is written down.
  const line = await seed(page);
  await tapAmount(page, line, 'available');
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('300');
  await commit(page);

  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(30000);
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$300.00');
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$300.00');
});

test('and with money already spent, the two still agree', async ({ page }) => {
  // The case the sign error hides in. $12.50 spent, ask for $300 available,
  // and the budget has to be $312.50 — not $287.50.
  const line = await seed(page);

  await page.getByTestId('tab-transactions').click();
  await page.getByTestId('add-button').click();
  await page.getByTestId('name-input').fill('Co-op');
  await page.getByTestId('amount-input').fill('-1250');
  await page.getByTestId('category-button').click();
  await page.getByTestId(`category-opt-${line}`).click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('save-button')).toBeHidden();

  await page.getByTestId('tab-budget').click();
  await tapAmount(page, line, 'available');
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('300');
  await commit(page);

  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(31250);
  await expect(page.getByTestId(`line-available-${line}`)).toHaveText('$300.00');
});

test('spent is shown and cannot be typed over', async ({ page }) => {
  // A budget screen that let you edit the money that actually moved would be
  // a budget screen that lies. There is no `line-spent-tap-*` at all — the
  // other two columns have one and this one deliberately does not.
  const line = await seed(page);
  await expect(page.getByTestId(`line-spent-${line}`)).toBeVisible();
  await expect(page.getByTestId(`line-budgeted-tap-${line}`)).toBeVisible();
  await expect(page.getByTestId(`line-available-tap-${line}`)).toBeVisible();
  await expect(page.getByTestId(`line-spent-tap-${line}`)).toHaveCount(0);
});

test('tapping away COMMITS — it is the other way out, not a cancel', async ({ page }) => {
  // Sean, 2026-08-21: "no need for done, the user can just hit return or tap
  // away." Both finish the edit. This deliberately REVERSES the previous
  // behaviour, where the backdrop cancelled and a test pinned that — so the
  // test is rewritten rather than deleted, and says which way round it goes.
  //
  // There is no cancel at all now, and that is a real trade: the value is
  // live, the row behind shows it land, and `−` puts back whatever `+` added.
  const line = await seed(page);
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-add').click();
  await page.getByTestId('pad-amount').fill('50');
  await page.getByTestId('pad-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('pad-amount')).toBeHidden();

  expect(liveLines(await stored(page) as Stored)[0]?.budget).toBe(30000);
  await expect(page.getByTestId(`line-budgeted-${line}`)).toHaveText('$300.00');
});

test('the box is small, centred under what was tapped, and never off-screen', async ({ page }) => {
  // "very small, like a little box directly underneath... close to centered
  // but obviously adjusting for the edges of the screen" — three claims about
  // geometry, so all three are measured.
  const line = await seed(page);
  const view = page.viewportSize()!;

  // BUDGETED sits in the middle of the row's numbers, so a centred box fits
  // and no clamp applies: its centre should land on the cell's.
  const mid = await page.getByTestId(`line-budgeted-tap-${line}`).boundingBox();
  await tapAmount(page, line, 'budgeted');
  const onMid = await page.getByTestId('pad-amount').boundingBox();

  // Under half the screen. It has been asked to be smaller three times;
  // the number here moves with it so the claim stays worth checking.
  expect(onMid!.width).toBeLessThan(view.width * 0.5);
  expect(onMid!.y).toBeGreaterThan(mid!.y);
  expect(Math.abs((onMid!.x + onMid!.width / 2) - (mid!.x + mid!.width / 2))).toBeLessThan(12);

  await commit(page);

  // AVAILABLE is the last column, where centring would push the box off the
  // right edge. It stops at the margin instead — which is the whole reason
  // centring needs a clamp rather than just being a nicer default.
  const end = await page.getByTestId(`line-available-tap-${line}`).boundingBox();
  await tapAmount(page, line, 'available');
  const onEnd = await page.getByTestId('pad-amount').boundingBox();

  expect(onEnd!.x + onEnd!.width).toBeLessThanOrEqual(view.width);
  expect(onEnd!.x).toBeGreaterThanOrEqual(0);
  // Genuinely clamped: pushed left of where a centred box would have gone.
  expect(onEnd!.x + onEnd!.width / 2).toBeLessThan(end!.x + end!.width / 2);
});
