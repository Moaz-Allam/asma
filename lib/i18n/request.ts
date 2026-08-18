import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

/**
 * Per-request locale + messages.
 *
 * An unrecognised locale falls back to the default rather than throwing here —
 * the 404 for a bad URL segment is raised by the layout's `hasLocale` guard,
 * which is the place that knows it is a routing error rather than a config one.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
