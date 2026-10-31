import { describe, expect, it } from 'vitest';

import { REGIONS, currencyFor, getRegion, isRegion, regionFromEnv } from '@/lib/region';

describe('region is a row value, never an environment constant (D14)', () => {
  it('reads the region off the owning row', () => {
    expect(getRegion({ region: 'TR' })).toBe('TR');
    expect(getRegion({ region: 'KSA' })).toBe('KSA');
  });

  it('refuses a row with no valid region rather than guessing one', () => {
    expect(() => getRegion({ region: undefined })).toThrow(/no valid region/);
    expect(() => getRegion({ region: 'EG' })).toThrow(/no valid region/);
  });

  it('refuses to resolve a region from the environment', () => {
    expect(() => regionFromEnv()).toThrow(/not an environment variable/);
  });

  it('derives currency from region, never from locale', () => {
    expect(currencyFor('TR')).toBe('TRY');
    expect(currencyFor('KSA')).toBe('SAR');
  });

  it('ships exactly the two agreed regions', () => {
    expect([...REGIONS]).toEqual(['TR', 'KSA']);
    expect(isRegion('TR')).toBe(true);
    expect(isRegion('tr')).toBe(false);
  });
});
