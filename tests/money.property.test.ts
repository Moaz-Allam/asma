import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertSameCurrency, money } from '@/lib/money/money';
import type { Currency } from '@/lib/region';

/**
 * Property tests for the money type (rule 4). fast-check generates thousands of inputs, including
 * the edge cases people forget (-0, huge integers, tiny fractions, NaN, Infinity). The ledger
 * properties (postings always balance, replays never double post) join this file in position 07.
 */

const currency = fc.constantFrom<Currency>('TRY', 'SAR');

describe('money() accepts integer minor units and nothing else', () => {
  it('keeps every safe integer amount exactly', () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), currency, (amount, c) => {
        const m = money(amount, c);
        expect(m.amount).toBe(amount);
        expect(m.currency).toBe(c);
      }),
    );
  });

  it('refuses every fractional amount', () => {
    const fractional = fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .filter((x) => !Number.isInteger(x));
    fc.assert(
      fc.property(fractional, currency, (amount, c) => {
        expect(() => money(amount, c)).toThrow(/integer in minor units/);
      }),
    );
  });

  it('refuses NaN and infinities', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => money(amount, 'TRY')).toThrow(/integer in minor units/);
    }
  });
});

describe('currencies never mix', () => {
  it('throws exactly when the currencies differ', () => {
    fc.assert(
      fc.property(fc.integer(), currency, fc.integer(), currency, (a, ca, b, cb) => {
        const check = () => assertSameCurrency(money(a, ca), money(b, cb));
        if (ca === cb) expect(check).not.toThrow();
        else expect(check).toThrow(/Refusing to combine/);
      }),
    );
  });
});
