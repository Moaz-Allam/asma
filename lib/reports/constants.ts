/**
 * The pure pieces of a problem report (spec 0011-14), safe in the browser: the reason codes, the text limits and
 * every code the report functions raise. Postgres checks each one again (R-3, X-16, R-4).
 */

export const REPORT_REASONS = [
  'no_show',
  'did_not_pay_cash',
  'poor_work',
  'safety_or_behaviour',
  'asked_money_off_platform',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Spec 0011-19a AC-9, X-13: the reasons of a warning admin gives from the quality watchlist. A report still has only
 * the six reasons above; a warning has those six or these five.
 */
export const QUALITY_WARNING_REASONS = [
  'low_rating',
  'high_reports',
  'high_cancellations',
  'low_follow_through',
  'probation_issue',
] as const;
export const WARNING_REASONS = [...REPORT_REASONS, ...QUALITY_WARNING_REASONS] as const;
export type WarningReason = (typeof WARNING_REASONS)[number];

/** Spec 0011-19a AC-9: the warning reason a quality flag's kind gives (both probation kinds read `probation_issue`). */
export function qualityWarningReason(kind: string): (typeof QUALITY_WARNING_REASONS)[number] | null {
  if (kind === 'probation_report' || kind === 'probation_cancel') return 'probation_issue';
  return (QUALITY_WARNING_REASONS as readonly string[]).includes(kind) && kind !== 'probation_issue'
    ? (kind as (typeof QUALITY_WARNING_REASONS)[number])
    : null;
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

/** R-3: 20 to 1000 characters after the trim, and at most 4000 bytes before it. */
export const REPORT_TEXT_MIN = 20;
export const REPORT_TEXT_MAX = 1000;
export const REPORT_TEXT_MAX_BYTES = 4000;

/** Code points after the trim, as Postgres `char_length(catalog_trim(...))` counts them for plain spaces. */
export function reportTextLength(text: string): number {
  return [...text.trim()].length;
}

/** Every code `open_report`, `add_report_photo`, `my_report` and `acknowledge_warning` raise. */
export const REPORT_DB_CODES = [
  'not_allowed',
  'validation_failed',
  'report_open',
  'report_limit',
  'too_many_reports',
  'report_settings_invalid',
  'too_many_photos',
  'file_invalid',
  'not_found',
] as const;
export type ReportCode = (typeof REPORT_DB_CODES)[number];

/** AC-5: what admin may do with a report. */
export const REPORT_OUTCOMES = [
  'no_action',
  'warned',
  'suspended',
  'returned_to_work',
  'job_closed',
] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

/** Every code `handle_report`, `admin_reports`, `admin_report_detail` and `log_report_photo_view` raise (AC-5). */
export const ADMIN_REPORT_DB_CODES = [
  'forbidden',
  'not_found',
  'already_handled',
  'invalid_outcome',
  'invalid_state',
  'already_suspended',
  'invalid_refund',
  'provider_not_approved',
  'validation_failed',
  'file_missing',
  'confirm_settings_invalid',
] as const;
export type AdminReportCode = (typeof ADMIN_REPORT_DB_CODES)[number];

/** R-12: admin's note, 10 to 500 characters after the trim. */
export const NOTE_MIN = 10;
export const NOTE_MAX = 500;

/** X-21: 20 reports a page. */
export const REPORTS_PAGE_SIZE = 20;
