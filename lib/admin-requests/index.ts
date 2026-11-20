import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';

import {
  ADMIN_REQUEST_DB_CODES,
  type AdminRequestCode,
  type CancelAttribution,
  type ExtendWhich,
} from './constants';
import {
  AdminAddressResult,
  AdminCancelResult,
  AdminClearResult,
  AdminExtendResult,
  AdminFlagQueue,
  AdminRefundDoneResult,
  AdminRefundResult,
  AdminRequestDetail,
  AdminRequestList,
} from './schemas';

/**
 * Admin's one door to a request's money trail (spec 0011-12 AC-8, AC-9, AC-12) and to the operations of spec 0011-16
 * (R-11): the list, the cancel, the extension, the flag queue and the street line. Each wrapper calls a definer
 * function as the signed in admin; `is_admin()` is checked inside each and every write is audited there with the
 * free text. No argument is an amount: a refund is always the paid fee's own (AC-7, rule 1). A mapped code reaches
 * no Sentry report; anything else is thrown for `guardedAction` or the page to report.
 */

export type { AdminFee, AdminFlagQueue, AdminRefund, AdminRequestDetail, AdminRequestList } from './schemas';

type Refused = { ok: false; code: AdminRequestCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refusalCode(error: unknown): AdminRequestCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (ADMIN_REQUEST_DB_CODES as readonly string[]).includes(message)
    ? (message as AdminRequestCode)
    : null;
}

async function call(fn: string, args: Record<string, unknown>): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const code = refusalCode(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

/**
 * One request as admin reads it (AC-12): the summary without the address, every application, the fees, refunds,
 * ledger lines, flags and the audit timeline. Null for a malformed or unknown id (the page shows 404).
 */
export async function loadAdminRequest(id: string): Promise<AdminRequestDetail | null> {
  if (!UUID.test(id)) return null;
  const result = await call('admin_request_detail', { p_request_id: id });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`admin_request_detail refused: ${result.code}`);
  }
  return AdminRequestDetail.parse(result.data);
}

/**
 * Refund a paid fee by hand (AC-8, §36 row 11): a commission once the request is cancelled or revealed, a provider
 * fee once its own pick was revealed. The reason (10 to 500 characters) goes only into the audit row (R-11). A
 * second call returns the first refund.
 */
export async function refundFee(input: {
  paymentId: string;
  reason: string;
}): Promise<{ ok: true; replayed: boolean } | Refused> {
  const result = await call('admin_refund_fee', { p_payment_id: input.paymentId, p_reason: input.reason });
  if ('ok' in result) return result;
  return { ok: true, replayed: AdminRefundResult.parse(result.data).replayed };
}

/**
 * Record a refund the PSP refused as done by hand in the PSP panel (AC-9, R-10): only a `failed` refund; it posts
 * the refund's journal and audits the note. A second call is a replay.
 */
export async function markRefundDone(input: {
  refundId: string;
  note: string;
}): Promise<{ ok: true; replayed: boolean } | Refused> {
  const result = await call('admin_mark_refund_done', { p_refund_id: input.refundId, p_note: input.note });
  if ('ok' in result) return result;
  return { ok: true, replayed: AdminRefundDoneResult.parse(result.data).replayed };
}

/** Spec 0011-16 R-2: the list's filters. Null means no filter. */
export type ListFilters = {
  status: string | null;
  region: 'TR' | 'KSA' | null;
  from: string | null;
  to: string | null;
  hasFlag: boolean | null;
  page: number;
};

/**
 * One page of every region's requests (R-1, R-2), newest first, 20 a page, with the total for the pager. A filter
 * Postgres refuses (`validation_failed`) comes back as such for the page to explain.
 */
export async function listRequests(filters: ListFilters): Promise<AdminRequestList | Refused> {
  const result = await call('admin_requests', {
    p_status: filters.status,
    p_region: filters.region,
    p_from: filters.from,
    p_to: filters.to,
    p_has_flag: filters.hasFlag,
    p_page: Math.min(10000, Math.max(1, Math.floor(filters.page))),
  });
  if ('ok' in result) return result;
  return AdminRequestList.parse(result.data);
}

/**
 * Cancel a request as admin (R-3, X-1, X-2, X-9): any state before AWAITING_CONFIRMATION, attributed to the customer,
 * the provider or the platform, with a reason; both go only to the audit row. Nothing is refunded here: admin refunds
 * each paid fee with `refundFee`. A second cancel is a replay.
 */
export async function cancelRequest(input: {
  requestId: string;
  attributedTo: CancelAttribution;
  reason: string;
}): Promise<{ ok: true; replayed: boolean } | Refused> {
  const result = await call('admin_cancel_request', {
    p_request_id: input.requestId,
    p_attributed_to: input.attributedTo,
    p_reason: input.reason,
  });
  if ('ok' in result) return result;
  return { ok: true, replayed: AdminCancelResult.parse(result.data).replayed };
}

/** Extend one deadline once (R-5, X-5 to X-7): 1 to 48 hours from the later of the old deadline and now. */
export async function extendDeadline(input: {
  requestId: string;
  which: ExtendWhich;
  hours: number;
  reason: string;
}): Promise<{ ok: true; deadline: string } | Refused> {
  const result = await call('admin_extend_deadline', {
    p_request_id: input.requestId,
    p_which: input.which,
    p_hours: input.hours,
    p_reason: input.reason,
  });
  if ('ok' in result) return result;
  return { ok: true, deadline: AdminExtendResult.parse(result.data).deadline };
}

/**
 * The street line of a revealed request (R-8, X-13). Each call writes one audit row with the reason, never the line;
 * the caller hands the line only to the client component that asked, so nothing is cached or rendered on the server.
 */
export async function showAddress(input: {
  requestId: string;
  reason: string;
}): Promise<{ ok: true; line: string } | Refused> {
  const result = await call('admin_request_address', {
    p_request_id: input.requestId,
    p_reason: input.reason,
  });
  if ('ok' in result) return result;
  return { ok: true, line: AdminAddressResult.parse(result.data).line };
}

/** One page of open deadline flags, oldest first (R-7); `total` is the rail's badge. */
export async function listFlags(page: number): Promise<AdminFlagQueue> {
  const result = await call('admin_flags', { p_page: Math.min(10000, Math.max(1, Math.floor(page))) });
  if ('ok' in result) throw new Error(`admin_flags refused: ${result.code}`);
  return AdminFlagQueue.parse(result.data);
}

/** Clear an open flag by hand with a note (R-7, X-15); it is never raised again for that request and kind. */
export async function clearFlag(input: { flagId: string; note: string }): Promise<{ ok: true } | Refused> {
  const result = await call('admin_clear_flag', { p_flag_id: input.flagId, p_note: input.note });
  if ('ok' in result) return result;
  AdminClearResult.parse(result.data);
  return { ok: true };
}
