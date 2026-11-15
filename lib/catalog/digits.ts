/**
 * Digits as admin types them, in the browser and on the server alike: string steps only, never a float
 * (rule 4). Arabic Indic (U+0660 to U+0669) and Persian (U+06F0 to U+06F9) digits fold to 0 to 9, as
 * `lib/money/parse.ts` does for money (spec 0007 AC-22, review 2026-11-15).
 */

const EASTERN = /[٠-٩۰-۹]/g;

/** Eastern digits to ASCII digits; everything else stays as it is. */
export function foldDigits(text: string): string {
  return text.replace(EASTERN, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * A whole number of up to 6 digits, with a minus sign when `allowNegative`, or null. `3.5`, `1e3`, `+3`
 * and a blank are refused, never rounded or guessed.
 */
export function parseWhole(text: string, options: { allowNegative?: boolean } = {}): number | null {
  if (typeof text !== 'string') return null;
  const folded = foldDigits(text.trim()).replace('−', '-');
  const pattern = options.allowNegative ? /^-?[0-9]{1,6}$/ : /^[0-9]{1,6}$/;
  if (!pattern.test(folded)) return null;
  const value = Number(folded);
  return Object.is(value, -0) ? 0 : value;
}

/**
 * A decimal count of minor units as the database wrote it (`350000.0000`) to the same amount in major units
 * (`3500.00`), by moving the decimal mark two places. Trailing zeros past two decimals are dropped, the rest
 * kept, so nothing is rounded. Text that is not a decimal comes back unchanged.
 */
export function minorTextToMajor(text: string): string {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(text.trim());
  if (!match) return text;
  const [, sign = '', whole = '', frac = ''] = match;
  const padded = whole.padStart(3, '0');
  const major = padded.slice(0, -2).replace(/^0+(?=[0-9])/, '');
  const decimals = `${padded.slice(-2)}${frac}`.replace(/0+$/, '').padEnd(2, '0');
  const body = `${major}.${decimals}`;
  return sign === '-' && /[1-9]/.test(body) ? `-${body}` : body;
}
