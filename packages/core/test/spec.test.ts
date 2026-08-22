/**
 * The spec replay.
 *
 * `spec/*.json` is the behavior contract, kept outside this package because
 * it is not TypeScript's to own — the intent is that a native port replays
 * the same vectors. Changing what AcctMind DOES starts by editing a case in
 * there and watching this file go red.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, amountDigits, applyOp, availableOf, budgetFor, dayOf,
  dayToDate, entryCents, formatAmount, formatDay, isDay, monthGrid, monthLabel,
  parseAmount, signedCents, sortTxns,
} from '../src/index';
import type { AmountOp } from '../src/index';
import type { AmountMode } from '../src/index';
import type { SortMode, Txn } from '../src/index';

const spec = <T,>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../../spec/${name}.json`, import.meta.url), 'utf8')) as T;

/** Keys beginning with `_` are prose for a human reading the file. */
const groups = <T,>(o: Record<string, unknown>): [string, T][] =>
  Object.entries(o).filter(([k]) => !k.startsWith('_')) as [string, T][];

describe('spec/money.json', () => {
  const m = spec<{
    parse: Record<string, [string, number | null][]>;
    format: [number, string][];
    roundTrip: number[];
  }>('money');

  for (const [group, cases] of groups<[string, number | null][]>(m.parse)) {
    it(`parses: ${group}`, () => {
      for (const [input, want] of cases) {
        expect(parseAmount(input), JSON.stringify(input)).toBe(want);
      }
    });
  }

  it('formats', () => {
    for (const [cents, want] of m.format) {
      expect(formatAmount(cents), String(cents)).toBe(want);
    }
  });

  // The property the module exists for: anything we display, we can read back.
  it('round-trips format -> parse', () => {
    for (const cents of m.roundTrip) {
      expect(parseAmount(formatAmount(cents)), String(cents)).toBe(cents);
    }
  });
});

describe('spec/money.json — typing an amount', () => {
  const m = spec<{
    entry: Record<AmountMode, [string, string, number | null][]>;
    digits: [string, string][];
    signed: [string, boolean, number | null, number | null][];
  }>('money');

  for (const mode of ['cents', 'whole'] as const) {
    it(`keeps and reads what is typed, in ${mode} mode`, () => {
      for (const [typed, kept, cents] of m.entry[mode]) {
        const text = amountDigits(typed);
        expect(text, `cleaning ${JSON.stringify(typed)}`).toBe(kept);
        expect(entryCents(text, mode), `${JSON.stringify(typed)} in ${mode}`).toBe(cents);
      }
    });
  }

  it('the field keeps digits and a dot, and no sign at all', () => {
    for (const [raw, kept] of m.digits) {
      expect(amountDigits(raw), JSON.stringify(raw)).toBe(kept);
    }
  });

  it('never keeps a character it was not given', () => {
    // The other half of the same claim, as a property rather than a table: a
    // filter that PASSED something through would be caught by the rows above,
    // but one that INVENTED a character would not.
    for (const [raw, kept] of m.digits) {
      for (const ch of kept) expect(raw.includes(ch), `${raw} -> ${kept}`).toBe(true);
      expect(/^[0-9.]*$/.test(kept), kept).toBe(true);
    }
  });

  it('composes the digits with the button beside them', () => {
    for (const [digits, negative, inCents, inWhole] of m.signed) {
      expect(signedCents(digits, negative, 'cents'), `${digits} ${negative}`).toBe(inCents);
      expect(signedCents(digits, negative, 'whole'), `${digits} ${negative}`).toBe(inWhole);
    }
  });

  it('and never produces a negative zero, which JSON would turn back into zero', () => {
    expect(Object.is(signedCents('0', true, 'cents'), -0)).toBe(false);
    expect(Object.is(signedCents('00', true, 'whole'), -0)).toBe(false);
  });

  it('what the field produces is always something parseAmount can read back', () => {
    // The field writes a canonical string into the draft and core validates
    // THAT. If these two ever disagree, a person types a valid amount and the
    // form tells them it is not one.
    for (const mode of ['cents', 'whole'] as const) {
      for (const [typed] of m.entry[mode]) {
        for (const negative of [false, true]) {
          const cents = signedCents(amountDigits(typed), negative, mode);
          if (cents === null) continue;
          expect(parseAmount(formatAmount(cents)), `${typed} in ${mode}`).toBe(cents);
        }
      }
    }
  });
});

describe('spec/day.json', () => {
  const d = spec<{
    valid: string[];
    invalid: string[];
    roundTrip: string[];
    format: [string, string, string][];
    addDays: [string, number, string][];
    addMonths: [string, number, string][];
    monthGrid: [string, number, (string | null)[], (string | null)[]][];
    monthLabel: [string, string][];
  }>('day');

  it('accepts real calendar days', () => {
    for (const day of d.valid) expect(isDay(day), day).toBe(true);
  });

  it('rejects everything else', () => {
    for (const day of d.invalid) expect(isDay(day), JSON.stringify(day)).toBe(false);
  });

  // The UTC trap, pinned: a day -> local Date -> day must not move.
  it('round-trips through a local Date', () => {
    for (const day of d.roundTrip) expect(dayOf(dayToDate(day)), day).toBe(day);
  });

  it('formats', () => {
    for (const [day, now, want] of d.format) expect(formatDay(day, now), day).toBe(want);
  });

  it('shifts by whole days', () => {
    for (const [from, n, want] of d.addDays) {
      expect(addDays(from, n), `${from} ${n >= 0 ? '+' : ''}${n}`).toBe(want);
    }
  });

  it('shifts by whole months, clamping', () => {
    for (const [from, n, want] of d.addMonths) {
      expect(addMonths(from, n), `${from} ${n >= 0 ? '+' : ''}${n}mo`).toBe(want);
    }
  });

  it('lays out a month grid', () => {
    for (const [anchor, weeks, firstRow, lastRow] of d.monthGrid) {
      const grid = monthGrid(anchor);
      expect(grid.length, `${anchor} week count`).toBe(weeks);
      expect(grid[0], `${anchor} first row`).toEqual(firstRow);
      expect(grid[grid.length - 1], `${anchor} last row`).toEqual(lastRow);
      // Whatever the month, every row is seven cells and every real day in
      // the month appears exactly once.
      for (const row of grid) expect(row).toHaveLength(7);
      const days = grid.flat().filter((c): c is string => c !== null);
      expect(new Set(days).size).toBe(days.length);
      expect(days.every((c) => c.startsWith(anchor.slice(0, 8)))).toBe(true);
    }
  });

  it('labels a month', () => {
    for (const [day, want] of d.monthLabel) expect(monthLabel(day), day).toBe(want);
  });
});

describe('spec/sort.json', () => {
  const s = spec<{
    cases: { name: string; in: { id: string; date: string; created: number }[]; out: string[] }[];
  }>('sort');

  for (const c of s.cases) {
    it(c.name, () => {
      const txns: Txn[] = c.in.map((r) => ({
        ...r, name: r.id, description: '', amount: 0, updated: r.created,
        account: 'a1', category: null, order: 0,
      }));
      expect(sortTxns(txns).map((t) => t.id)).toEqual(c.out);
    });
  }
});

describe('spec/sortmodes.json', () => {
  const s = spec<{
    cases: { name: string; mode: SortMode; in: [string, string, number, number, number][]; out: string[] }[];
  }>('sortmodes');

  for (const c of s.cases) {
    it(`${c.mode}: ${c.name}`, () => {
      const txns: Txn[] = c.in.map(([id, date, created, amount, order]) => ({
        id, name: id, description: '', amount, date, account: 'a1', category: null,
        order, created, updated: created,
      }));
      expect(sortTxns(txns, c.mode).map((t) => t.id)).toEqual(c.out);
    });
  }
});

describe('spec/budget.json', () => {
  const b = spec<{
    available: [number, number, number][];
    roundTrip: [number, number][];
    ops: [number, AmountOp, number, number | null][];
  }>('budget');

  it('available is budgeted PLUS spent — money out is negative', () => {
    for (const [budget, spent, want] of b.available) {
      expect(availableOf(budget, spent), `${budget} / ${spent}`).toBe(want);
    }
  });

  it('budgetFor is the exact inverse, both ways round', () => {
    for (const [available, spent] of b.roundTrip) {
      const budget = budgetFor(available, spent);
      // The identity the two-way edit rests on: type into either field and
      // the other one follows, with nothing lost on the way back.
      expect(availableOf(budget, spent), `${available} / ${spent}`).toBe(available);
      expect(budgetFor(availableOf(budget, spent), spent)).toBe(budget);
    }
  });

  it('the operator picker', () => {
    for (const [current, op, typed, want] of b.ops) {
      expect(applyOp(current, op, typed), `${current} ${op} ${typed}`).toBe(want);
    }
  });
});
