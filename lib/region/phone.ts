/**
 * Phone numbers: what a person types, turned into the E.164 number Auth stores. Spec 0005 AC-2, D16.
 *
 * No `server-only` here, and no import of it: the login form refuses a bad number in the browser, with
 * no Auth call. This refusal is a courtesy. The refusal that holds is the before_user_created hook.
 *
 * ⚠️ `MOBILE_PATTERNS` is one of three copies, with `phone_region()` and the `profiles` check.
 * tests/region-phone.test.ts reads both out of the migration and fails if they drift.
 *
 * Digit folding lives here, in a `.ts` file, so no Arabic character sits in a `.tsx` file (rule 10).
 */

export const MOBILE_PATTERNS = {
  TR: /^\+905[0-9]{9}$/,
  KSA: /^\+9665[0-9]{8}$/,
} as const;

export type PhoneRegion = keyof typeof MOBILE_PATTERNS;

export type PhoneRejection = 'not_mobile' | 'too_short' | 'other_country';

export type NormalizedPhone = { ok: true; phone: string } | { ok: false; reason: PhoneRejection };

/** National digits of a mobile number, per dial code. */
const NATIONAL_LENGTH: Readonly<Record<string, number>> = { '+90': 10, '+966': 9 };

/** Spaces, separators and the invisible direction marks that come with text pasted from RTL pages. */
const NOISE = /[\s \-.()‎‏‪-‮⁦-⁩]/g;

/** The region of an E.164 mobile number, or null. Same answer as `phone_region()`. */
export function phoneRegion(phone: string): PhoneRegion | null {
  if (MOBILE_PATTERNS.TR.test(phone)) return 'TR';
  if (MOBILE_PATTERNS.KSA.test(phone)) return 'KSA';
  return null;
}

/** Arabic Indic (U+0660..) and Eastern Arabic Indic (U+06F0..) digits to Western digits. */
export function foldDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * E.164 for a number typed in the given region, or why it cannot be one.
 * `555 123 45 67`, `0555 123 45 67`, `90 555 123 45 67` and `+90 555 123 45 67` are all the same number.
 */
export function normalizePhone(input: string, dialCode: string): NormalizedPhone {
  const nationalLength = NATIONAL_LENGTH[dialCode];
  if (nationalLength === undefined) return { ok: false, reason: 'other_country' };

  const dialDigits = dialCode.slice(1);
  const typed = foldDigits(input).replace(NOISE, '').replace(/^00/, '+');
  const digits = typed.replace(/\D/g, '');

  let national: string;
  if (typed.startsWith('+')) {
    if (!digits.startsWith(dialDigits)) return { ok: false, reason: 'other_country' };
    national = digits.slice(dialDigits.length);
  } else if (digits.length > nationalLength && digits.startsWith(dialDigits)) {
    national = digits.slice(dialDigits.length);
  } else {
    national = digits.startsWith('0') ? digits.slice(1) : digits;
  }

  if (national.length < nationalLength) return { ok: false, reason: 'too_short' };

  const phone = `${dialCode}${national}`;
  return phoneRegion(phone) === null ? { ok: false, reason: 'not_mobile' } : { ok: true, phone };
}

/**
 * Spec 0013 (D224): extra dial codes the form lets through, for numbers on the database's `test_phones` list only.
 * Empty unless `NEXT_PUBLIC_PHONE_TEST_DIAL_CODES` is set (for example `+20`); the before_user_created hook still
 * refuses any number that is not listed, so this only stops the browser refusing it first.
 */
export function testDialCodes(
  raw: string | undefined = process.env.NEXT_PUBLIC_PHONE_TEST_DIAL_CODES,
): string[] {
  return (raw ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => /^\+[1-9][0-9]{0,3}$/.test(code));
}

/** A number typed with a `+` and one of the test dial codes, as E.164; null when it is not one of those. */
export function normalizeTestPhone(input: string, codes: readonly string[]): NormalizedPhone | null {
  if (codes.length === 0) return null;
  const typed = foldDigits(input).replace(NOISE, '').replace(/^00/, '+');
  if (!typed.startsWith('+')) return null;
  const digits = typed.slice(1).replace(/\D/g, '');
  if (!codes.some((code) => digits.startsWith(code.slice(1)))) return null;
  const phone = `+${digits}`;
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? { ok: true, phone } : { ok: false, reason: 'too_short' };
}

/**
 * The same, against every active region: the first that accepts the number wins, else the first answer.
 * One region at launch; switching KSA on is a data change, so `+966 ...` then simply works (AC-3).
 * Since spec 0013, a number no region accepts is tried against the test dial codes last.
 */
export function normalizeForRegions(
  input: string,
  dialCodes: readonly string[],
  testCodes: readonly string[] = testDialCodes(),
): NormalizedPhone {
  const results = dialCodes.map((dialCode) => normalizePhone(input, dialCode));
  const found = results.find((result) => result.ok);
  if (found) return found;
  return normalizeTestPhone(input, testCodes) ?? results[0] ?? { ok: false, reason: 'other_country' };
}
