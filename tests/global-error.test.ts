import { describe, expect, it } from 'vitest';

import { dirFor } from '@/lib/i18n/direction';
import { localeOfPath } from '@/lib/i18n/path-locale';
import { routing } from '@/lib/i18n/routing';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

/**
 * Spec 0004 AC-17: a crash that escapes the locale layout shows the `Error` copy in the URL's locale,
 * with its direction, and in the default locale when the first segment is not a supported one.
 */

describe('the global error page picks its locale from the path', () => {
  it.each([
    ['/ar/requests/x', 'ar', 'rtl'],
    ['/tr', 'tr', 'ltr'],
    ['/en/a/b', 'en', 'ltr'],
  ] as const)('%s is %s, %s', (path, locale, dir) => {
    expect(localeOfPath(path)).toBe(locale);
    expect(dirFor(localeOfPath(path))).toBe(dir);
  });

  it.each(['/xx/y', '/TR/x', '/', '', null, undefined])('%j falls back to the default locale', (path) => {
    expect(localeOfPath(path)).toBe(routing.defaultLocale);
  });

  it('has its copy in every catalogue', () => {
    for (const catalogue of [ar, tr, en]) {
      expect(catalogue.Error.generic.length).toBeGreaterThan(0);
      expect(catalogue.Error.retry.length).toBeGreaterThan(0);
    }
  });
});
