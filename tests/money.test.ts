import { describe, expect, it } from 'vitest';

import { assertSameCurrency, money } from '@/lib/money/money';

describe('money is integer minor units (Rule 4)', () => {
  it('accepts integers', () => {
    expect(money(12500, 'TRY')).toEqual({ amount: 12500, currency: 'TRY' });
  });

  it('refuses a fractional amount — a float here means one entered the pipeline', () => {
    expect(() => money(125.5, 'TRY')).toThrow(/integer in minor units/);
    expect(() => money(0.1 + 0.2, 'SAR')).toThrow(/integer in minor units/);
  });

  it('refuses to combine two currencies', () => {
    expect(() => assertSameCurrency(money(100, 'TRY'), money(100, 'SAR'))).toThrow(/Refusing/);
  });

  it('allows the same currency', () => {
    expect(() => assertSameCurrency(money(100, 'TRY'), money(250, 'TRY'))).not.toThrow();
  });
});
