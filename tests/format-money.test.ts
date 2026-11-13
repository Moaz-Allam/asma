import { describe, expect, it } from 'vitest';

import { formatMoney } from '@/lib/format/money';

/** ui-rules.md §6, i18n.md §7: grouping follows the locale, digits are Western in all three (D52). */
describe('formatMoney', () => {
  it('follows the locale', () => {
    expect(formatMoney(320_000, 'TRY', 'tr')).toBe('₺3.200');
    expect(formatMoney(320_000, 'TRY', 'en')).toBe('₺3,200');
  });

  it('keeps Western digits in Arabic', () => {
    expect(formatMoney(320_000, 'TRY', 'ar')).toMatch(/3,200/);
    expect(formatMoney(320_000, 'TRY', 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('shows the minor units only when there are any', () => {
    expect(formatMoney(320_050, 'TRY', 'en')).toBe('₺3,200.50');
  });

  it('refuses a float: the amount is integer minor units (rule 4)', () => {
    expect(() => formatMoney(10.5, 'TRY', 'en')).toThrow(/integer/);
  });
});
