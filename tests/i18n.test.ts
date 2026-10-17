import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, LOCALES, dirFor, isLocale } from '@/lib/i18n/direction';
import { routing } from '@/lib/i18n/routing';

describe('direction is derived from the locale, never hardcoded (Rule 10)', () => {
  it('maps ar to rtl and the Latin-script locales to ltr', () => {
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('tr')).toBe('ltr');
    expect(dirFor('en')).toBe('ltr');
  });

  it('defaults an unknown locale to ltr rather than throwing', () => {
    // The 404 for a bad URL segment is the layout's job; this helper must stay total.
    expect(dirFor('zz')).toBe('ltr');
  });

  it('ships exactly the three agreed locales', () => {
    expect([...LOCALES]).toEqual(['ar', 'tr', 'en']);
    expect(routing.locales).toEqual(LOCALES);
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE);
  });

  it('recognises only known locales', () => {
    expect(isLocale('tr')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});

describe('message catalogues (Rule 10 — no raw key ever reaches a customer)', () => {
  const flatten = (o: Record<string, unknown>, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`],
    );

  it('has every key in all three locales', async () => {
    const loaded = await Promise.all(
      LOCALES.map(async (l) => [l, (await import(`../messages/${l}.json`)).default] as const),
    );
    const keys = new Map(loaded.map(([l, m]) => [l, new Set(flatten(m))]));
    const all = new Set([...keys.values()].flatMap((s) => [...s]));

    for (const [locale, set] of keys) {
      const missing = [...all].filter((k) => !set.has(k));
      expect(missing, `messages/${locale}.json is missing: ${missing.join(', ')}`).toEqual([]);
    }
  });
});
