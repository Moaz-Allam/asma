import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';

import { ADMIN_REQUEST_DB_CODES, type AdminRequestCode } from './constants';
import { AdminRefundDoneResult, AdminRefundResult, AdminRequestDetail } from './schemas';

/**
 * Admin's one door to a request's money trail (spec 0011-12 AC-8, AC-9, AC-12). Each wrapper calls a definer
 * function as the signed in admin; `is_admin()` is checked inside each and every write is audited there with the
 * free text. No argument is an amount: a refund is always the paid fee's own (AC-7, rule 1). A mapped code reaches
 * no Sentry report; anything else is thrown for `guardedAction` or the page to report.
 */

export type { AdminFee, AdminRefund, AdminRequestDetail } from './schemas';

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
