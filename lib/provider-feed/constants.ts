/**
 * The pure pieces of position 05 (spec 0009), safe in the browser: limits, codes, the date chips and the
 * day order. Every rule that matters is checked again in Postgres; these only shape the form and the page.
 */

/** AC-9, AC-10 step 11: code points after the trim. The action accepts more, so the database refuses. */
export const MESSAGE_MIN = 20;
export const MESSAGE_MAX = 600;
export const MESSAGE_INPUT_MAX = 2000;

/**
 * Spec 0011-19b AC-4: a text answer is 10 to its question's limit (600 at most) code points after the trim. The
 * action accepts more, so the database gives the real refusal.
 */
export const ANSWER_MIN = 10;
export const ANSWER_MAX = 600;
export const ANSWERS_MAX_KEYS = 16;
export const APPLICATION_QUESTION_TYPES = ['textarea', 'single_select', 'boolean'] as const;
export type ApplicationQuestionType = (typeof APPLICATION_QUESTION_TYPES)[number];

/** AC-3: the most picks one save may carry. */
export const SETUP_LIMITS = { services: 50, zones: 100 } as const;

/** The fields a `setup_invalid` refusal names (AC-3). */
export const SETUP_FIELDS = ['services', 'zones', 'work_days', 'hours'] as const;
export type SetupField = (typeof SETUP_FIELDS)[number];

/** Every code the provider feed functions raise or return. */
export const PROVIDER_FEED_DB_CODES = [
  'forbidden',
  'provider_suspended',
  'setup_invalid',
  'not_approved',
  'setup_incomplete',
  'not_found',
  'request_closed',
  'apply_settings_invalid',
  'request_full',
  'too_many_applications',
  'message_invalid',
  'contact_info_in_message',
  // Spec 0011-10 (10): the provider pays the provider fee.
  'validation_failed',
  'invalid_state',
  'already_paid',
  'deadline_passed',
  'payments_disabled',
  'too_many_checkouts',
  'checkout_settings_invalid',
  'unlock_settings_invalid',
  // Spec 0011-11 (11): work and close.
  'too_early',
  'confirm_settings_invalid',
  // Spec 0011-12 (12): withdraw and the unlocked provider's cancel.
  'not_cancellable',
  'checkout_open',
  // Spec 0011-13 R-10, AC-10: the apply gate, while the region's apply_needs_email is on.
  'email_unconfirmed',
  // Spec 0011-19a AC-6: on probation, at the live job limit.
  'probation_limit',
  // Spec 0011-19b AC-4: the form's questions changed, an answer is invalid, or holds contact details.
  'questions_changed',
  'answers_invalid',
  'contact_info_in_answer',
] as const;
export type ProviderFeedCode = (typeof PROVIDER_FEED_DB_CODES)[number];

/** Spec 0011-10 R-11: the My jobs tabs, each a fixed set of application statuses in Postgres. */
export const JOB_TABS = ['applied', 'chosen', 'active', 'done'] as const;
export type JobTab = (typeof JOB_TABS)[number];

/** `?tab=`, falling back to Applied. */
export function parseJobTab(value: unknown): JobTab {
  return typeof value === 'string' && (JOB_TABS as readonly string[]).includes(value)
    ? (value as JobTab)
    : 'applied';
}

/**
 * Spec 0011-11 (X-13 of 0011-15): the application statuses each My jobs tab shows, the same sets as `provider_jobs`
 * in `20261123090000_work_and_close.sql` (Active keeps a job until it closes). A unit test reads that migration.
 */
export const JOB_TAB_STATUSES: Readonly<Record<JobTab, readonly ApplicationStatus[]>> = {
  applied: ['APPLIED', 'SELECTED'],
  chosen: ['AWAITING_FEE'],
  active: ['UNLOCKED', 'STARTED', 'COMPLETED'],
  done: ['CONFIRMED', 'RATED', 'NOT_SELECTED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED'],
};

/** Spec 0011-15 R-11: the My jobs tab an application status belongs to. */
export function jobTabFor(status: ApplicationStatus): JobTab {
  return JOB_TABS.find((tab) => JOB_TAB_STATUSES[tab].includes(status)) ?? 'done';
}

/** Spec 0011-15 R-10: `?month=YYYY-MM` as the first day of that month; anything else is null (the current month). */
export function parseHistoryMonth(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return `${value}-01`;
}

/** The `?month=` value of a month start (`YYYY-MM-01` becomes `YYYY-MM`). */
export function historyMonthParam(monthStart: string): string {
  return monthStart.slice(0, 7);
}

/** The twelve application statuses of project-overview.md §22 (AC-17). */
export const APPLICATION_STATUSES = [
  'APPLIED',
  'SELECTED',
  'AWAITING_FEE',
  'UNLOCKED',
  'STARTED',
  'COMPLETED',
  'CONFIRMED',
  'RATED',
  'NOT_SELECTED',
  'WITHDRAWN',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** The chip tone of an application status (ui-rules.md, `StatusChip`). */
export function applicationTone(status: ApplicationStatus): 'waiting' | 'negative' | 'neutral' | 'info' {
  if (status === 'APPLIED' || status === 'SELECTED' || status === 'AWAITING_FEE') return 'waiting';
  if (status === 'NOT_SELECTED' || status === 'WITHDRAWN' || status === 'EXPIRED' || status === 'CANCELLED') {
    return 'negative';
  }
  return 'info';
}

/** The date chips of the feed (AC-5). */
export const WHEN = ['all', 'week', 'next'] as const;
export type When = (typeof WHEN)[number];

export function parseWhen(value: unknown): When {
  return typeof value === 'string' && (WHEN as readonly string[]).includes(value) ? (value as When) : 'all';
}

/** 0 is Sunday, as Postgres `dow`. Weeks start Saturday in `ar`, Monday in `tr` and `en` (AC-2, AC-5). */
export function weekStartDay(locale: string): number {
  return locale === 'ar' ? 6 : 1;
}

/** The seven days in the order the locale reads a week. */
export function dayOrder(locale: string): number[] {
  const start = weekStartDay(locale);
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The region local dates `[from, to)` of a chip, from the region's today (AC-5): this week, the week after,
 * or no bounds. `today` is `YYYY-MM-DD` in the region's time zone.
 */
export function dateRange(today: string, locale: string, when: When): { from: string; to: string } | null {
  if (when === 'all') return null;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const back = (dow - weekStartDay(locale) + 7) % 7;
  const start = addDays(today, -back + (when === 'next' ? 7 : 0));
  return { from: start, to: addDays(start, 7) };
}

/** Today in a time zone, as `YYYY-MM-DD`. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Code points, as Postgres `char_length` counts them (AC-9's counter). */
export function codePoints(text: string): number {
  return [...text].length;
}
