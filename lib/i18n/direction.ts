/**
 * The ONLY place layout direction is decided.
 *
 * Rule 10: direction is derived from the locale at runtime, never hardcoded.
 * `ar` is RTL; `tr` and `en` are LTR. Adding a locale here flips the entire app
 * correctly, because every component uses logical properties (ms/me, ps/pe,
 * start/end) rather than physical ones.
 *
 * If you find yourself writing `dir="rtl"` anywhere else, that is the bug.
 */

export const LOCALES = ['ar', 'tr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

/** Locales written right-to-left. Everything else is left-to-right. */
const RTL_LOCALES = new Set<Locale>(['ar']);

export type Direction = 'rtl' | 'ltr';

export function dirFor(locale: string): Direction {
  return RTL_LOCALES.has(locale as Locale) ? 'rtl' : 'ltr';
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
