import { describe, expect, it } from 'vitest';

import { REGIONS, currencyFor, getRegion, isRegion, phoneMatchesRegion, regionFromEnv } from '@/lib/region';

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

describe('phone dialling code must match the account region (D16)', () => {
  it('accepts a matching dialling code', () => {
    expect(phoneMatchesRegion('+905551234567', 'TR')).toBe(true);
    expect(phoneMatchesRegion('+966551234567', 'KSA')).toBe(true);
  });

  it('rejects a cross-region number — no override at launch', () => {
    expect(phoneMatchesRegion('+905551234567', 'KSA')).toBe(false);
    expect(phoneMatchesRegion('+966551234567', 'TR')).toBe(false);
  });

  it('tolerates spacing and dashes', () => {
    expect(phoneMatchesRegion('+90 555 123 45 67', 'TR')).toBe(true);
  });
});
