/**
 * Writing a CSV, which is the half this app had never done.
 *
 * Everything in `csv.ts` above these functions reads a bank's export; Sean
 * asked for the other direction on 2026-09-21 ("export budget"). The rules
 * that matter are RFC 4180's and the one that is this app's own: the
 * amounts go out as PLAIN NUMBERS, because a spreadsheet cannot add up
 * `-$1,234.56`.
 */
import { describe, expect, it } from 'vitest';
import { budgetCsv, csvCell, parseDelimited, toCsv } from '../src/index';

describe('csvCell', () => {
  it('leaves an ordinary cell alone', () => {
    // Quoting everything is also valid and is what a lazy writer does. It
    // makes the file unreadable in a terminal, which is where a person looks
    // when the import at the other end goes wrong.
    expect(csvCell('Groceries')).toBe('Groceries');
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('')).toBe('');
  });

  it('quotes the three characters that would end the cell, row or field', () => {
    expect(csvCell('Food, drink')).toBe('"Food, drink"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('DOUBLES an inner quote rather than escaping it', () => {
    // A backslash is a C convention; every spreadsheet reads the doubled one.
    expect(csvCell('a"b')).not.toContain('\\');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});

describe('toCsv', () => {
  it('joins with CRLF and ends with one', () => {
    // RFC 4180 says so, Excel on Windows needs it, and a file whose last row
    // has no terminator is the one that loses its last line to a naive
    // splitter.
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n');
  });

  it('writes nothing at all for no rows', () => {
    // Not a lone newline: an empty file is empty.
    expect(toCsv([])).toBe('');
  });

  it('round-trips through this app\'s own reader', () => {
    // Not proof that the writer is RIGHT — both halves could share a
    // misunderstanding — but it does prove the quoting and the unquoting
    // agree, which is where a hand-written writer usually parts company
    // with a real parser. `parseDelimited` is the reader banks' files go
    // through, and it has its own vectors in spec/csv.json.
    const cells = [
      ['Category', 'Line'],
      ['Food, drink', 'say "hi"'],
      ['two\nlines', ''],
    ];
    expect(parseDelimited(toCsv(cells))).toEqual(cells);
  });
});

describe('budgetCsv', () => {
  const rows = [
    { category: 'Food', line: 'Groceries', assigned: 25000, spent: -12550, available: 12450 },
    { category: 'Fun', line: 'Cinema, late', assigned: 0, spent: -450, available: -450 },
  ];

  it('heads the file and writes dollars as plain numbers', () => {
    // `-$125.50` is a string a person reads and a string a spreadsheet
    // cannot add up: the separator makes it text in every locale and the
    // symbol makes it text in the rest.
    expect(budgetCsv(rows)).toBe(
      'Category,Line,Assigned,Spent,Available\r\n'
      + 'Food,Groceries,250.00,-125.50,124.50\r\n'
      + 'Fun,"Cinema, late",0.00,-4.50,-4.50\r\n',
    );
  });

  it('writes a header and nothing else for an empty budget', () => {
    // An empty file would read as a failed export; a header alone says
    // "this ran, and there was nothing in it".
    expect(budgetCsv([])).toBe('Category,Line,Assigned,Spent,Available\r\n');
  });

  it('never loses a cent to a float', () => {
    // Every amount in this app is integer minor units and is divided by 100
    // exactly once, at the edge. 1 cent must not come out as 0.
    expect(budgetCsv([{ category: 'c', line: 'l', assigned: 1, spent: 0, available: 1 }]))
      .toContain('c,l,0.01,0.00,0.01');
  });
});
