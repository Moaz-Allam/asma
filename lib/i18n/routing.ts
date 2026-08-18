import { defineRouting } from 'next-intl/routing';

import { DEFAULT_LOCALE, LOCALES } from './direction';

/**
 * Locale routing. See context/i18n.md §4.
 *
 * `localePrefix: 'as-needed'` (D13) — the default locale is unprefixed (`/requests`),
 * every other locale carries its segment (`/tr/requests`).
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeCookie: {
    // Long-lived: a returning visitor should land in the language they chose.
    maxAge: 60 * 60 * 24 * 365,
  },
});
