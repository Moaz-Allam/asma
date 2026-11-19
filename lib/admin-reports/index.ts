import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import {
  ADMIN_REPORT_DB_CODES,
  type AdminReportCode,
  type ReportOutcome,
  type ReportReason,
} from '@/lib/reports/constants';
import { REPORTS_BUCKET, SIGNED_LINK_SECONDS } from '@/lib/storage/buckets';
import { signedLink } from '@/lib/storage/server';

import { HandleResult, PhotoView, ReportDetail, ReportQueue } from './schemas';

/**
 * Admin's one door to problem reports (spec 0011-14 AC-4, AC-5). Each wrapper calls a definer function as the signed
 * in admin; `is_admin()` is checked inside each. No argument is an amount: a refund names one of the request's own
 * fee rows (R-11). The note goes only into the report row (R-12). A photo is signed only after its view row exists
 * (X-3). A mapped code reaches no Sentry report; anything else is thrown for `guardedAction` or the page to report.
 */

export type { ReportDetail, ReportParty, ReportQueue, ReportRow } from './schemas';

type Refused = { ok: false; code: AdminReportCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refusalCode(error: unknown): AdminReportCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (ADMIN_REPORT_DB_CODES as readonly string[]).includes(message)
    ? (message as AdminReportCode)
    : null;
}

type AdminReportFn =
  | 'admin_reports'
  | 'admin_reports_open_count'
  | 'admin_report_detail'
  | 'handle_report'
  | 'log_report_photo_view';

async function call(fn: AdminReportFn, args: Record<string, unknown>): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) {
    const code = refusalCode(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

/** X-21: one page of a tab; Open oldest first, Handled newest handled first. */
export async function loadReports(tab: 'open' | 'handled', page: number): Promise<ReportQueue> {
  const result = await call('admin_reports', { p_tab: tab, p_page: Math.max(1, Math.floor(page)) });
  if ('ok' in result) throw new Error(`admin_reports refused: ${result.code}`);
  return ReportQueue.parse(result.data);
}

/** The rail's badge (AC-4). */
export async function openReportsCount(): Promise<number> {
  const result = await call('admin_reports_open_count', {});
  if ('ok' in result) throw new Error(`admin_reports_open_count refused: ${result.code}`);
  return typeof result.data === 'number' ? result.data : 0;
}

/** X-22: the report, its two parties with their counts, and the photo list. Null for a malformed or unknown id. */
export async function loadReport(id: string): Promise<ReportDetail | null> {
  if (!UUID.test(id)) return null;
  const result = await call('admin_report_detail', { p_report_id: id });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`admin_report_detail refused: ${result.code}`);
  }
  return ReportDetail.parse(result.data);
}

/** AC-5: handle a report once, with a note, an optional refund of one of the request's fees and a warning reason. */
export async function handleReport(input: {
  reportId: string;
  outcome: ReportOutcome;
  note: string;
  refundPaymentId: string | null;
  warningReason: ReportReason | null;
}): Promise<{ ok: true; outcome: ReportOutcome; refunded: boolean } | Refused> {
  const result = await call('handle_report', {
    p_report_id: input.reportId,
    p_outcome: input.outcome,
    p_note: input.note,
    p_refund_payment_id: input.refundPaymentId,
    p_warning_reason: input.warningReason,
  });
  if ('ok' in result) return result;
  const parsed = HandleResult.parse(result.data);
  return { ok: true, outcome: parsed.outcome, refunded: parsed.fee_refund_id !== null };
}

/** AC-4, X-3: record the view, then sign a 60 second link. Null when Storage refuses or the object is gone. */
export async function reportPhotoLink(photoId: string): Promise<{ ok: true; url: string | null } | Refused> {
  if (!UUID.test(photoId)) return { ok: false, code: 'not_found' };
  const result = await call('log_report_photo_view', { p_photo_id: photoId });
  if ('ok' in result) return result;
  const view = PhotoView.parse(result.data);
  return { ok: true, url: await signedLink(REPORTS_BUCKET, view.path, SIGNED_LINK_SECONDS) };
}
