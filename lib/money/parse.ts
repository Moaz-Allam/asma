import 'server-only';

/**
 * Money input (spec 0007 AC-22, rule 4). Admin types an amount in major units; the server turns that text
 * into integer minor units with string steps only, never a float, so `1200.50` is 120050 exactly. The
 * browser does no money arithmetic: it sends the text, an action parses it here.
 *
 * Each function takes `.`, `,` or the Arabic decimal separator (U+066B) as the one decimal mark, and folds
 * Arabic Indic (U+0660 to U+0669) and Persian (U+06F0 to U+06F9) digits to 0 to 9. Grouping marks,
 * exponents and signs other than a leading minus are refused, so a value is never guessed.
 */

/** The largest amount an admin may type, in minor units (base price, addon, fixed amount). */
export const MAX_MINOR = 100_000_000;

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** Fold Eastern digits to ASCII and every accepted decimal mark to `.`. Trims the ends. */
function normalise(text: string): string {
  let out = '';
  for (const ch of text.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (ch === ',' || ch === '٫') {
      out += '.';
    } else if (ch === '−') {
      out += '-';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Whole digits, then at most one mark followed by 1 to `decimals` digits. */
function split(text: string, decimals: number): { negative: boolean; whole: string; frac: string } | null {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole = '', frac = ''] = match;
  if (frac.length > decimals) return null;
  return { negative: sign === '-', whole: whole.replace(/^0+(?=[0-9])/, ''), frac };
}

/**
 * Major units as text to integer minor units, or null. Up to two decimals; at most `MAX_MINOR` either way.
 * A sign only with `allowNegative` (a fixed discount).
 */
export function parseMinor(text: string, options: { allowNegative?: boolean } = {}): number | null {
  if (typeof text !== 'string') return null;
  const parts = split(normalise(text), 2);
  if (!parts) return null;
  if (parts.negative && !options.allowNegative) return null;
  // Integer digits only from here: the fraction is padded to exactly two digits and joined on.
  const digits = `${parts.whole}${parts.frac.padEnd(2, '0')}`.replace(/^0+(?=[0-9])/, '');
  if (digits.length > String(MAX_MINOR).length) return null;
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return null;
  return parts.negative && minor !== 0 ? -minor : minor;
}

/** Integer minor units to the text `parseMinor` reads back: `1200.50`, `-400`, `0.05`. Fills a field. */
export function formatMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`formatMinor takes integer minor units, got ${minor}.`);
  }
  const digits = String(Math.abs(minor)).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const frac = digits.slice(-2);
  const text = frac === '00' ? whole : `${whole}.${frac}`;
  return minor < 0 ? `-${text}` : text;
}

/**
 * Integer minor units to decimal text with exactly two decimals, by integer arithmetic only (rule 4): `1200.00`,
 * `-4.05`, `0.00`. For machine readers such as the revenue CSV (spec 0011-16 R-10, X-14), where `formatMinor`'s
 * short form would vary in width.
 */
export function formatMinorFixed(minor: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`formatMinorFixed takes integer minor units, got ${minor}.`);
  }
  const digits = String(Math.abs(minor)).padStart(3, '0');
  const text = `${digits.slice(0, -2)}.${digits.slice(-2)}`;
  return minor < 0 ? `-${text}` : text;
}

/**
 * A factor (up to 4 decimals) or a zone multiplier (up to 2) as its canonical text, or null: no sign, no
 * leading zeros, no trailing zeros. It travels as a string to `numeric` and is never rounded here: one
 * decimal too many is refused. The range is the database's to check.
 */
export function parseFactor(text: string, decimals: 2 | 4): string | null {
  if (typeof text !== 'string') return null;
  const parts = split(normalise(text), decimals);
  if (!parts || parts.negative) return null;
  const frac = parts.frac.replace(/0+$/, '');
  return frac === '' ? parts.whole : `${parts.whole}.${frac}`;
}
