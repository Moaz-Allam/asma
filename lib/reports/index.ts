import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';

import { REPORT_DB_CODES, type ReportCode, type ReportReason } from './constants';
import { AckResult, AddPhotoResult, MyReport, MyWarning, OpenReportResult } from './schemas';

/**
 * The customer's and the provider's one door to problem reports (spec 0011-14 AC-1, AC-2, AC-6, AC-7). Each wrapper
 * calls a definer function as the signed in user; Postgres decides who is a party, the window, the limits and the
 * photo rules (R-1 to R-4, X-5). No table is read directly (R-15). A mapped code reaches no Sentry report; anything
 * else is thrown for `guardedAction` or the page to report.
 */

export type { MyReport, MyWarning } from './schemas';

type Refused = { ok: false; code: ReportCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refusalCode(error: unknown): ReportCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (REPORT_DB_CODES as readonly string[]).includes(message)
    ? (message as ReportCode)
    : null;
}

type ReportFn = 'open_report' | 'add_report_photo' | 'my_report' | 'my_warning' | 'acknowledge_warning';

async function call(fn: ReportFn, args: Record<string, unknown>): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) {
    const code = refusalCode(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

/** AC-1: a new report against the other party of a request. The text is trimmed and judged by Postgres (R-3). */
export async function openReport(input: {
  requestId: string;
  reason: ReportReason;
  text: string;
}): Promise<{ ok: true; reportId: string } | Refused> {
  const result = await call('open_report', {
    p_request_id: input.requestId,
    p_reason: input.reason,
    p_text: input.text,
  });
  if ('ok' in result) return result;
  return { ok: true, reportId: OpenReportResult.parse(result.data).report_id };
}

/** AC-2, X-25: register a photo already uploaded under the report's folder. A replay is ok. */
export async function addReportPhoto(input: {
  reportId: string;
  path: string;
}): Promise<{ ok: true; replayed: boolean } | Refused> {
  const result = await call('add_report_photo', { p_report_id: input.reportId, p_object_path: input.path });
  if ('ok' in result) return result;
  return { ok: true, replayed: AddPhotoResult.parse(result.data).replayed };
}

/** AC-7: whether the caller can report on this request now, and their latest report's state. Null for anyone else. */
export async function myReport(requestId: string): Promise<MyReport | null> {
  if (!UUID.test(requestId)) return null;
  const result = await call('my_report', { p_request_id: requestId });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`my_report refused: ${result.code}`);
  }
  return MyReport.parse(result.data);
}

/** AC-6: the caller's oldest warning not acknowledged yet, or null. */
export async function myWarning(): Promise<MyWarning> {
  const result = await call('my_warning', {});
  if ('ok' in result) throw new Error(`my_warning refused: ${result.code}`);
  return MyWarning.parse(result.data);
}

/** AC-6: acknowledge the caller's own warning; a replay is ok, any other id is `not_found`. */
export async function acknowledgeWarning(
  warningId: string,
): Promise<{ ok: true; replayed: boolean } | Refused> {
  const result = await call('acknowledge_warning', { p_warning_id: warningId });
  if ('ok' in result) return result;
  return { ok: true, replayed: AckResult.parse(result.data).replayed };
}
