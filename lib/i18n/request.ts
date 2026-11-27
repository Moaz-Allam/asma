import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';
import { withoutDraftLabel } from './draft-label';

/** Keep the legal draft markers in source for the launch gate; omit the label from rendered copy. */
export function displayMessages<T>(value: T): T {
  if (typeof value === 'string') return withoutDraftLabel(value) as T;
  if (Array.isArray(value)) return value.map(displayMessages) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayMessages(item)])) as T;
  }
  return value;
}

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
    messages: displayMessages((await import(`../../messages/${locale}.json`)).default),
  };
});
