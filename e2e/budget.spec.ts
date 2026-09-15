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
  const cat = s.categories.filter((c) => c.deleted !== true).slice(-1)[0]?.id ?? '';
  await page.getByTestId(`manage-name-${cat}`).fill('Groceries');
  await page.getByTestId('manage-done').click();
  return makeLine(page, cat, 'Produce', '250');
}

/**
 * Make a line inside a category, name it, and budget it.
 *
 * The + creates the line OUTRIGHT now — Sean, 2026-09-15, "get rid of the
 * edit screen for budget, everything can be edited from the screen itself" —
 * so this is three in-place steps where it used to be one modal: add, rename
 * under the pencil, then set the amount with the pad.
 */
async function makeLine(
  page: Page, category: string, name: string, budget: string,
): Promise<string> {
  await page.getByTestId(`category-add-${category}`).click();
  const made = liveLines(await stored(page) as Stored)
    .filter((l) => l.category === category).pop();
  const id = made?.id ?? '';

  await page.getByTestId('budget-edit-toggle').click();
  // WAIT for edit mode to be on screen before tapping the name. Clicking
  // straight after the toggle lands on a Pressable React has not re-rendered
  // yet — its onPress is still undefined, the click does nothing, and the
  // failure reads as "the rename field never opened".
  await expect(page.getByTestId(`line-delete-${id}`)).toBeVisible();
  await page.getByTestId(`line-name-${id}`).click();
  await page.getByTestId(`line-name-input-${id}`).fill(name);
  await page.getByTestId(`line-name-input-${id}`).press('Enter');
  await page.getByTestId('budget-edit-toggle').click();

  await page.getByTestId(`line-budgeted-tap-${id}`).click();
  await expect(page.getByTestId('pad-amount')).toBeVisible();
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill(budget);
  await page.getByTestId('pad-amount').press('Enter');
  await expect(page.getByTestId('pad-amount')).toBeHidden();
  return id;
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
  // BESIDE the cell, not necessarily below it. "Directly underneath" is the
  // preference and the pad takes it when there is room; against the bottom of
  // the window it flips above rather than hanging off the screen, which is
  // the clamp doing its job. Asserting `y >` broke the day a default category
  // pushed the row far enough down to trigger the flip — a true statement
  // about the old layout, not about the rule. What the rule actually promises
  // is that the box stays WITH its cell.
  expect(Math.abs(onMid!.y - mid!.y)).toBeLessThan(220);
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

/*
 * Needs, Snooze, and the four colours. Sean, 2026-09-15.
 *
 * The arithmetic is core's — `lineTone` and `stillNeeded`, replayed from
 * spec/budget.json. What is only checkable here is that the screen ASKS it:
 * that the fourth column is wired to `needs` rather than to budget, that the
 * checkbox writes `snoozed`, and that each verdict reaches the right colour.
 *
 * These read the COMPUTED COLOUR, not visibility. Every one of these states
 * has the same numbers on screen, laid out identically, all "visible" — the
 * only difference is what colour they are painted, so that is what the
 * assertion has to be about. The transparent-row bug taught this repo the
 * same lesson from the other direction.
 */
const TONE = {
  snoozed: 'rgb(72, 72, 74)',
  over: 'rgb(255, 69, 58)',
  short: 'rgb(240, 180, 41)',
  funded: 'rgb(48, 209, 88)',
};

const colourOf = (page: Page, id: string) =>
  page.getByTestId(`line-budgeted-${id}`).evaluate((el) => getComputedStyle(el).color);

test('Needs is its own stored number, beside budgeted and not the same as it', async ({ page }) => {
  const line = await seed(page);
  await page.getByTestId(`line-needs-tap-${line}`).click();
  await expect(page.getByTestId('pad-amount')).toBeVisible();
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('400');
  await commit(page);

  const s = await stored(page) as Stored & { lines: { id: string; needs: number }[] };
  const row = s.lines.find((l) => l.id === line);
  expect(row?.needs).toBe(40000);
  // And it did NOT move what was budgeted. Two stored numbers, not one.
  expect(row?.budget).toBe(25000);
});

test('a line short of its target is yellow, and funding it turns it green', async ({ page }) => {
  const line = await seed(page);            // budgeted $250
  expect(await colourOf(page, line)).toBe(TONE.funded);

  // Ask for more than is assigned.
  await page.getByTestId(`line-needs-tap-${line}`).click();
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('400');
  await commit(page);
  expect(await colourOf(page, line)).toBe(TONE.short);

  // Assign the rest.
  await tapAmount(page, line, 'budgeted');
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('400');
  await commit(page);
  expect(await colourOf(page, line)).toBe(TONE.funded);
});

test('a target of zero is not "short" — most lines never set one', async ({ page }) => {
  // The case that decides whether the colour means anything: if every line
  // without a target painted yellow, the whole screen would be yellow.
  const line = await seed(page);
  const s = await stored(page) as Stored & { lines: { id: string; needs: number }[] };
  expect(s.lines.find((l) => l.id === line)?.needs).toBe(0);
  expect(await colourOf(page, line)).toBe(TONE.funded);
});

test('Snooze greys the line, and beats being short', async ({ page }) => {
  const line = await seed(page);
  await page.getByTestId(`line-needs-tap-${line}`).click();
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('400');
  await commit(page);
  expect(await colourOf(page, line)).toBe(TONE.short);

  await page.getByTestId(`line-snooze-${line}`).click();
  expect(await colourOf(page, line)).toBe(TONE.snoozed);
  const s = await stored(page) as Stored & { lines: { id: string; snoozed: boolean }[] };
  expect(s.lines.find((l) => l.id === line)?.snoozed).toBe(true);

  // And pressing it again wakes it back to exactly what it was.
  await page.getByTestId(`line-snooze-${line}`).click();
  expect(await colourOf(page, line)).toBe(TONE.short);
});

test('overspending is red, and beats being short', async ({ page }) => {
  // Money already spent that you do not have is worse than money not yet
  // assigned — so when a line is both, red is what shows.
  const line = await seed(page);
  await page.getByTestId(`line-needs-tap-${line}`).click();
  await page.getByTestId('pad-amount-op-set').click();
  await page.getByTestId('pad-amount').fill('400');
  await commit(page);

  // Drive available below zero. The − OPERATOR, not a typed minus: the pad's
  // field takes digits only since the sign moved onto its own control.
  await tapAmount(page, line, 'available');
  await page.getByTestId('pad-amount-op-sub').click();
  await page.getByTestId('pad-amount').fill('400');
  await commit(page);
  expect(await colourOf(page, line)).toBe(TONE.over);
});

test('a line is two lines, so the name and the numbers both fit', async ({ page }) => {
  // Sean, 2026-09-15: "always make this two lines". One row could not hold
  // them — four money columns, the snooze box and the grip left the name 52
  // points on a phone and drew `New line` as `New li…`, and widening the name
  // truncated the numbers instead.
  //
  // Measured at PHONE width in both projects, because the desktop one is 1280
  // and everything fits there whatever the layout does — the check would pass
  // by having nothing to say.
  await page.setViewportSize({ width: 390, height: 800 });
  const line = await seed(page);

  await page.getByTestId('budget-edit-toggle').click();
  await expect(page.getByTestId(`line-delete-${line}`)).toBeVisible();
  await page.getByTestId(`line-name-${line}`).click();
  await page.getByTestId(`line-name-input-${line}`).fill('Groceries and household');
  await page.getByTestId(`line-name-input-${line}`).press('Enter');
  await page.getByTestId('budget-edit-toggle').click();

  // The name is NOT clipped: scrollWidth is what it needs, clientWidth what
  // it got, and on one line it got far less than it needed.
  const name = await page.getByTestId(`line-name-${line}`)
    .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(name.client).toBeGreaterThanOrEqual(name.scroll);

  // And the numbers sit BELOW it rather than beside it.
  const nameBox = await page.getByTestId(`line-name-${line}`).boundingBox();
  const num = await page.getByTestId(`line-budgeted-${line}`).boundingBox();
  expect(num!.y).toBeGreaterThan(nameBox!.y + nameBox!.height - 2);

  // Every column still readable rather than elided, with a wide amount in it.
  for (const col of ['needs', 'budgeted', 'spent', 'available']) {
    const cell = await page.getByTestId(`line-${col}-${line}`)
      .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(cell.client, col).toBeGreaterThanOrEqual(cell.scroll);
  }
});
