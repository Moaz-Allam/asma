import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatMinor, MAX_MINOR, parseFactor, parseMinor } from '@/lib/money/parse';

/**
 * Money input (spec 0007 AC-22, rule 4). Admin types major units as text; the server turns them into
 * integer minor units with string steps, never a float. The table is verify.md's.
 */

describe('parseMinor', () => {
  it.each([
    ['1200', 120000],
    ['1200.50', 120050],
    ['1200,50', 120050],
    ['1200٫50', 120050],
    ['١٢٠٠', 120000],
    ['۱۲۰۰', 120000],
    ['0.05', 5],
    ['0.5', 50],
    ['  12 ', 1200],
    ['1000000', 100000000],
    ['007', 700],
  ])('reads %j as %d', (text, minor) => {
    expect(parseMinor(text)).toBe(minor);
  });

  it('takes a sign only where one is allowed', () => {
    expect(parseMinor('-400', { allowNegative: true })).toBe(-40000);
    expect(parseMinor('−400', { allowNegative: true })).toBe(-40000);
    expect(parseMinor('-400')).toBeNull();
  });

  it.each([
    '1000000.01',
    '1.200,50',
    '1,200.50',
    '12.345',
    '1e3',
    '',
    '   ',
    '.',
    '12.',
    '.5',
    '+5',
    '1 200',
    '0x10',
    'Infinity',
    'NaN',
    '1200.5.0',
    '١٢٠٠.٥٠٠',
    '99999999999999999999',
  ])('refuses %j', (text) => {
    expect(parseMinor(text)).toBeNull();
  });

  it('refuses a value past the limit, signed or not', () => {
    expect(parseMinor('-1000000.01', { allowNegative: true })).toBeNull();
    expect(MAX_MINOR).toBe(100000000);
  });

  it('refuses anything that is not a string', () => {
    expect(parseMinor(12 as unknown as string)).toBeNull();
    expect(parseMinor(null as unknown as string)).toBeNull();
  });
});

describe('formatMinor', () => {
  it.each([
    [120050, '1200.50'],
    [-40000, '-400'],
    [5, '0.05'],
    [120000, '1200'],
    [0, '0'],
    [100000000, '1000000'],
  ])('writes %d as %j', (minor, text) => {
    expect(formatMinor(minor)).toBe(text);
  });

  it('refuses a fraction: a float in the pipeline is a bug', () => {
    expect(() => formatMinor(1.5)).toThrow();
  });

  it('round trips with parseMinor for every amount in range', () => {
    fc.assert(
      fc.property(fc.integer({ min: -MAX_MINOR, max: MAX_MINOR }), (minor) => {
        expect(parseMinor(formatMinor(minor), { allowNegative: true })).toBe(minor);
      }),
    );
  });

  it('every text parseMinor accepts formats back to the same amount', () => {
    const digits = fc.stringMatching(/^[0-9]{1,7}$/);
    const decimals = fc.stringMatching(/^[0-9]{0,2}$/);
    fc.assert(
      fc.property(digits, decimals, fc.constantFrom('.', ',', '٫'), (whole, frac, mark) => {
        const text = frac === '' ? whole : `${whole}${mark}${frac}`;
        const minor = parseMinor(text);
        if (minor === null) return;
        expect(parseMinor(formatMinor(minor))).toBe(minor);
      }),
    );
  });
});

describe('parseFactor', () => {
  it.each([
    ['1,3', 4, '1.3'],
    ['1.30', 4, '1.3'],
    ['1.3000', 4, '1.3'],
    ['10', 4, '10'],
    ['0.1', 4, '0.1'],
    ['1.2345', 4, '1.2345'],
    ['١٫٣٠', 2, '1.3'],
    ['1.15', 2, '1.15'],
    ['0.50', 2, '0.5'],
    ['02.0', 2, '2'],
  ])('reads %j with %d decimals as %j', (text, decimals, canonical) => {
    expect(parseFactor(text, decimals as 2 | 4)).toBe(canonical);
  });

  it.each([
    ['1.23456', 4],
    ['1.234', 2],
    ['', 4],
    ['-1.1', 4],
    ['1e1', 4],
    ['1.2.3', 4],
    ['1,000.5', 4],
    ['.5', 4],
  ])('refuses %j with %d decimals, never rounding', (text, decimals) => {
    expect(parseFactor(text, decimals as 2 | 4)).toBeNull();
  });
});
