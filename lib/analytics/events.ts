import type { Locale } from '@/lib/i18n/direction';

/**
 * Every analytics event and its typed properties (spec 0004 AC-7, D68). Adding an event is a change
 * here, so a misspelt or unplanned name fails the build; `before_send` drops anything else at runtime.
 * Properties never name a person: no ids, no free text, nothing a user typed.
 */
export type AnalyticsEvents = {
  /** One per page, sent manually: on start and on every route change. URLs are scrubbed (AC-3). */
  $pageview: { $current_url: string; $pathname: string };
  /** The visitor switched language in LocaleSwitcher. */
  locale_changed: { from_locale: Locale; to_locale: Locale };
};

export type AnalyticsEvent = keyof AnalyticsEvents;

export const ANALYTICS_EVENTS: ReadonlySet<string> = new Set<AnalyticsEvent>(['$pageview', 'locale_changed']);

/** The typed property names per event: the only non `$` properties an event may carry. */
export const EVENT_PROPERTIES: Readonly<Record<AnalyticsEvent, readonly string[]>> = {
  $pageview: ['$current_url', '$pathname'],
  locale_changed: ['from_locale', 'to_locale'],
};
