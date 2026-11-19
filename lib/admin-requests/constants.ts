/**
 * The pure pieces of the admin request page (spec 0011-12 AC-8, AC-9, AC-12), safe in the browser: the codes the
 * admin functions raise and the reason limits. Postgres checks every one again.
 */

/** Every code `admin_refund_fee`, `admin_mark_refund_done` and `admin_request_detail` raise. */
export const ADMIN_REQUEST_DB_CODES = ['forbidden', 'not_found', 'invalid_state', 'reason_required'] as const;
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
