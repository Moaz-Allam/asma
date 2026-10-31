import { readFileSync, readdirSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MOBILE_PATTERNS,
  foldDigits,
  normalizePhone,
  phoneRegion,
  type PhoneRejection,
} from '@/lib/region/phone';

/**
 * Spec 0005 AC-2, AC-3. The mobile patterns live in three places on purpose: the `profiles` check, the
 * `phone_region()` function and this module. A check cannot read another table, and the browser refuses
 * a number before any Auth call. So this reads both out of the migration and proves they agree; the
 * sample table below is the same one supabase/tests/05 runs through phone_region().
 */

const SAMPLES: Array<[string, 'TR' | 'KSA' | null]> = [
  ['+905551234567', 'TR'],
  ['+905001234567', 'TR'],
  ['+966551234567', 'KSA'],
  ['+902121234567', null],
  ['+90555123456', null],
  ['+9055512345678', null],
  ['+966451234567', null],
  ['+4915112345678', null],
  ['905551234567', null],
  ['', null],
];

function migration(): string {
  const dir = 'supabase/migrations';
  const file = readdirSync(dir).find((f) => f.endsWith('_sign_in_and_roles.sql'));
  if (!file) throw new Error('sign in migration not found');
  return readFileSync(`${dir}/${file}`, 'utf8');
}

describe('the three copies of the mobile pattern (AC-3)', () => {
  it.each(SAMPLES)('phoneRegion(%j) is %j', (phone, region) => {
    expect(phoneRegion(phone)).toBe(region);
  });

  it.each(['TR', 'KSA'] as const)('the %s pattern is literally the one in the migration', (region) => {
    const sql = migration();
    const source = MOBILE_PATTERNS[region].source;
    expect(sql).toContain(`(region = '${region}' and phone ~ '${source}')`);
    expect(sql).toContain(`when p_phone ~ '${source}' then '${region}'`);
  });
});

describe('foldDigits', () => {
  it('folds both Arabic digit sets to Western digits', () => {
    expect(foldDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(foldDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('leaves everything else alone', () => {
    expect(foldDigits('+90 555')).toBe('+90 555');
  });
});

describe('normalizePhone (AC-2)', () => {
  it.each([
    '555 123 45 67',
    '0555 123 45 67',
    '+90 555 123 45 67',
    '5551234567',
    '05551234567',
    '+905551234567',
    '00905551234567',
    '905551234567',
    '(0555) 123-45-67',
    '0555.123.45.67',
    // Both Arabic digit sets, as a phone keyboard in Arabic types them.
    '٥٥٥ ١٢٣ ٤٥ ٦٧',
    '۰۵۵۵ ۱۲۳ ۴۵ ۶۷',
    // A number pasted out of right to left text carries invisible direction marks.
    '‎+90 555 123 45 67‏',
    '‪+90 555 123 45 67‬',
  ])('accepts %j', (input) => {
    expect(normalizePhone(input, '+90')).toEqual({ ok: true, phone: '+905551234567' });
  });

  it.each<[string, PhoneRejection]>([
    ['0212 123 45 67', 'not_mobile'],
    ['212 123 45 67', 'not_mobile'],
    ['+90 212 123 45 67', 'not_mobile'],
    ['555 123 45 678', 'not_mobile'],
    ['abc', 'too_short'],
    ['', 'too_short'],
    ['   ', 'too_short'],
    ['555', 'too_short'],
    ['0555 123 45', 'too_short'],
    ['+90 555 123', 'too_short'],
    ['+49 151 1234 5678', 'other_country'],
    ['+966 55 123 4567', 'other_country'],
    ['0049 151 1234 5678', 'other_country'],
  ])('refuses %j as %s', (input, reason) => {
    expect(normalizePhone(input, '+90')).toEqual({ ok: false, reason });
  });

  it('follows the dial code of the region it is given', () => {
    expect(normalizePhone('055 123 4567', '+966')).toEqual({ ok: true, phone: '+966551234567' });
    expect(normalizePhone('+90 555 123 45 67', '+966')).toEqual({ ok: false, reason: 'other_country' });
  });

  it('refuses a dial code it has no pattern for instead of guessing', () => {
    expect(normalizePhone('555 123 45 67', '+1')).toEqual({ ok: false, reason: 'other_country' });
  });

  it('only ever returns a number the database will accept', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...'0123456789+ -()٠٥٦') }), (input) => {
        const result = normalizePhone(input, '+90');
        if (result.ok) expect(phoneRegion(result.phone)).toBe('TR');
      }),
    );
  });
});
