import type { Locale } from '@/lib/i18n/direction';

/**
 * Formats integer minor units for display (`MoneyDisplay`). Never a calculation: the amount comes from the
 * server, and the division here only moves the decimal point for `Intl`. No `server-only`, so a Client
 * Component can show money it received.
 *
 * Digits are Western in all three locales (D52); `ar` needs the `nu-latn` extension for that.
 */

const NUMBER_LOCALE: Readonly<Record<Locale, string>> = { ar: 'ar-u-nu-latn', tr: 'tr', en: 'en' };

export function formatMoney(minorUnits: number, currency: 'TRY' | 'SAR', locale: Locale): string {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`Money must be integer minor units, got ${minorUnits}.`);
  }
  const digits = minorUnits % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], {
    style: 'currency',
    currency,
    // `en` would otherwise spell it TRY. The sign is what the design draws.
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minorUnits / 100);
}
