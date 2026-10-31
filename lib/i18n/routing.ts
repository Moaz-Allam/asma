import { defineRouting } from 'next-intl/routing';

import { DEFAULT_LOCALE, LOCALES } from './direction';

/**
 * Locale routing. See context/i18n.md §4.
 *
 * `localePrefix: 'always'` (D19, superseding D13's 'as-needed').
 *
 * Every locale carries its segment — `/ar/requests`, `/tr/requests`, `/en/requests`.
 * There is NO unprefixed route, deliberately: with `as-needed` exactly one locale
 * owns `/requests`, and this product has a per-region default (`tr` for TR, `ar`
 * for KSA). One URL cannot mean Turkish for one visitor and Arabic for another —
 * and region is not even known until login, so there is nothing to derive it from
 * at the moment the URL is served.
 *
 * `/` becomes a negotiation endpoint: the proxy redirects on the cookie, then
 * Accept-Language, then `defaultLocale`. `defaultLocale` below is that last-resort
 * fallback, not a statement about which market matters.
 */
/** next-intl's cookie, written by hand only in /continue (spec 0005 AC-10). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeCookie: {
    // Long-lived: a returning visitor should land in the language they chose.
    maxAge: LOCALE_COOKIE_MAX_AGE,
  },
});
