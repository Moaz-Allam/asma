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
  /** A provider saved their services, districts and hours (spec 0009 AC-21). Only the two counts. */
  provider_setup_saved: { services: number; zones: number };
  /** A provider applied to a request (spec 0009 AC-21). Nothing else: no id, price or text. A replay sends none. */
  application_submitted: Record<string, never>;
  /** A customer chose a provider (spec 0010 AC-16). Nothing else. A replay sends none. */
  provider_chosen: Record<string, never>;
  /** A card page attempt was opened, not reused (spec 0011-09 AC-14). Only which fee: no id, amount or text. */
  payment_started: { fee: 'commission' | 'provider_fee' };
  /** The return page first saw the fee paid (spec 0011-09 AC-14). Only which fee. */
  payment_succeeded: { fee: 'commission' | 'provider_fee' };
  /** A contact card first rendered for one side (spec 0011-10 AC-13). Only the side: no id, no contact field. */
  contacts_unlocked: { side: 'customer' | 'provider' };
  /** The provider pressed Started or Done (spec 0011-11 AC-10). No id, no text. */
  job_started: Record<string, never>;
  job_done: Record<string, never>;
  /** The customer closed the job: Confirm, or "Job done" without the provider (spec 0011-11 AC-10). */
  job_confirmed: { by: 'confirm' | 'mark_done' };
  /**
   * A party opened a problem report (spec 0011-14 AC-9). The reason code and the reporter's side only: no request
   * id (D194: no event carries an id), no text, no photo.
   */
  report_opened: {
    reason:
      | 'no_show'
      | 'did_not_pay_cash'
      | 'poor_work'
      | 'safety_or_behaviour'
      | 'asked_money_off_platform'
      | 'other';
    side: 'customer' | 'provider';
  };
  /** Admin handled a report (AC-9). The outcome only: no report id (D194), no note. */
  report_handled: { outcome: 'no_action' | 'warned' | 'suspended' | 'returned_to_work' | 'job_closed' };
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
  'provider_setup_saved',
  'application_submitted',
  'provider_chosen',
  'payment_started',
  'payment_succeeded',
  'contacts_unlocked',
  'job_started',
  'job_done',
  'job_confirmed',
  'report_opened',
  'report_handled',
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
  provider_setup_saved: ['services', 'zones'],
  application_submitted: [],
  provider_chosen: [],
  payment_started: ['fee'],
  payment_succeeded: ['fee'],
  contacts_unlocked: ['side'],
  job_started: [],
  job_done: [],
  job_confirmed: ['by'],
  report_opened: ['reason', 'side'],
  report_handled: ['outcome'],
};
