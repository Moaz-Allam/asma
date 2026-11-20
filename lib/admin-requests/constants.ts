/**
 * The pure pieces of the admin request page (spec 0011-12 AC-8, AC-9, AC-12), safe in the browser: the codes the
 * admin functions raise and the reason limits. Postgres checks every one again.
 */

/**
 * Every code the admin request functions raise: 12's `admin_refund_fee`, `admin_mark_refund_done` and
 * `admin_request_detail`, and 16's list, cancel, extension, flag and street line functions (spec 0011-16 R-11).
 */
export const ADMIN_REQUEST_DB_CODES = [
  'forbidden',
  'not_found',
  'invalid_state',
  'reason_required',
  'validation_failed',
  'not_cancellable',
  'checkout_open',
  'already_extended',
  'deadline_after_start',
  'already_cleared',
  'not_available',
] as const;
export type AdminRequestCode = (typeof ADMIN_REQUEST_DB_CODES)[number];

/** AC-8, R-11: the admin's reason or note, in code points after the trim. */
export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** Code points after the trim, as Postgres `char_length(btrim(...))` counts them. */
export function reasonLength(text: string): number {
  return [...text.trim()].length;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The "Find request by id" field (AC-12): a request id, trimmed, or null. */
export function requestIdFrom(value: string): string | null {
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

/** Spec 0011-16 R-3: who a cancel by admin is attributed to. Stored only on the audit row. */
export const CANCEL_ATTRIBUTIONS = ['customer', 'provider', 'platform'] as const;
export type CancelAttribution = (typeof CANCEL_ATTRIBUTIONS)[number];

/** Spec 0011-16 R-5: the three deadlines admin may extend, once each. */
export const EXTEND_WHICH = ['payment', 'fee', 'confirm'] as const;
export type ExtendWhich = (typeof EXTEND_WHICH)[number];

/** R-5: 1 to 48 hours. */
export const EXTEND_HOURS_MIN = 1;
export const EXTEND_HOURS_MAX = 48;

/** R-2, R-7: rows a page on the request list and the flag queue. */
export const ADMIN_PAGE_SIZE = 20;

/** R-2: the status filter's values, as `requests.status` holds them. */
export const LIST_STATUSES = [
  'OPEN',
  'SELECTED',
  'COMMISSION_PAID',
  'UNLOCKED',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
] as const;

/** R-5, X-5: the deadline a request's state can extend, or null. */
export function extendableDeadline(status: string, hasPick: boolean): ExtendWhich | null {
  if (status === 'SELECTED') return 'payment';
  if (status === 'COMMISSION_PAID' && hasPick) return 'fee';
  if (status === 'AWAITING_CONFIRMATION') return 'confirm';
  return null;
}

/** R-3: admin may cancel any state before AWAITING_CONFIRMATION that is not already cancelled. */
export function adminMayCancel(status: string): boolean {
  return ['OPEN', 'SELECTED', 'COMMISSION_PAID', 'UNLOCKED', 'IN_PROGRESS'].includes(status);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` day that exists on the calendar, or null. */
export function dayFrom(value: unknown): string | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
