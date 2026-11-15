/**
 * Text admin writes, in three languages (spec 0007 AC-2): `{ "ar": …, "tr": …, "en": … }`. The region's
 * default locale is required by the database, the others are optional. `localized()` runs on the server, so
 * a Client Component gets one string, never the whole object.
 */

export const CATALOG_LOCALES = ['ar', 'tr', 'en'] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];
export type LocalizedText = Partial<Record<CatalogLocale, string>>;

function textOf(value: unknown, locale: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const text = (value as Record<string, unknown>)[locale];
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/** The page's locale, then the region's default, then nothing. */
export function localized(value: unknown, locale: string, regionDefault: string): string {
  return textOf(value, locale) ?? textOf(value, regionDefault) ?? '';
}

/** The locales a row has no text for, so an admin list can show what is missing. */
export function missingLocales(value: unknown): CatalogLocale[] {
  return CATALOG_LOCALES.filter((locale) => textOf(value, locale) === null);
}

/** Only the three known locales, each a string, for filling a form. */
export function asLocalizedText(value: unknown): LocalizedText {
  const out: LocalizedText = {};
  for (const locale of CATALOG_LOCALES) {
    const text = textOf(value, locale);
    if (text !== null) out[locale] = text;
  }
  return out;
}
