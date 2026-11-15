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
  /** Sign in (spec 0005 AC-22, project-overview.md §17). A code went out. */
  code_requested: Record<string, never>;
  /** A code was accepted: the person is signed in. */
  code_verified: Record<string, never>;
  /** A send or a check hit a limit. Only the name of the limit, never the number. */
  code_limited: {
    limit: 'limit_phone' | 'limit_ip' | 'limit_sms_cap' | 'limit_sends' | 'limit_checks';
  };
  /** The form refused a number before any Auth call. Only the reason, never the number. */
  phone_rejected: { reason: 'not_mobile' | 'too_short' | 'other_country' };
  /** A new account chose its role. */
  onboarding_completed: { role: 'customer' | 'provider' };
  /** A provider sent their file for review (spec 0006 AC-24). */
  provider_file_submitted: Record<string, never>;
  /** Admin decided a file. Fired from the admin's browser until the server client lands (D68). */
  provider_decided: { decision: 'approved' | 'rejected' };
  /** An upload failed before or at Storage. Only the reason, never the file, its name or its path. */
  document_upload_failed: { reason: 'too_large' | 'wrong_type' | 'refused' | 'network' };
  /** A customer published a request (spec 0008 AC-25). Only whether it was a repeat: no id, price or text. */
  request_posted: { repeated: boolean };
};

export type AnalyticsEvent = keyof AnalyticsEvents;

export const ANALYTICS_EVENTS: ReadonlySet<string> = new Set<AnalyticsEvent>([
  '$pageview',
  'locale_changed',
  'code_requested',
  'code_verified',
  'code_limited',
  'phone_rejected',
  'onboarding_completed',
  'provider_file_submitted',
  'provider_decided',
  'document_upload_failed',
  'request_posted',
]);

/** The typed property names per event: the only non `$` properties an event may carry. */
export const EVENT_PROPERTIES: Readonly<Record<AnalyticsEvent, readonly string[]>> = {
  $pageview: ['$current_url', '$pathname'],
  locale_changed: ['from_locale', 'to_locale'],
  code_requested: [],
  code_verified: [],
  code_limited: ['limit'],
  phone_rejected: ['reason'],
  onboarding_completed: ['role'],
  provider_file_submitted: [],
  provider_decided: ['decision'],
  document_upload_failed: ['reason'],
  request_posted: ['repeated'],
};
