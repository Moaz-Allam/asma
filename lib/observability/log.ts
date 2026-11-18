import 'server-only';

import { getActiveSpan, getClient, getCurrentScope, logger, startNewTrace } from '@sentry/nextjs';

import { flushSoon } from '@/lib/observability/server';
import { isRegion, type Region } from '@/lib/region';

/**
 * The one server logger (spec 0004 AC-5, D67): every record goes to Sentry Logs, joined to its trace.
 *
 * A record names WHAT happened with an event from `LogEvent` and carries nothing else but its
 * correlation id and the internal ids in `LogIds`: no message text, no personal data, no URL path.
 * Sends are never awaited on the request path; they are flushed with `after()`. Without the SDK it
 * mirrors to the console. Never throws.
 */

/** Every server log event. 00b defines the first; each position adds its own. */
export type LogEvent =
  | 'flag_read_failed'
  // Spec 0006 AC-8: a replaced file could not be deleted; the row is right, and the next upload of that
  // type tries again.
  | 'document_sweep_failed'
  // Spec 0006 AC-16: the document.viewed row could not be written, so no link was signed.
  | 'document_view_audit_failed'
  // Spec 0007 AC-8: a customer's answers pushed a published formula past its ceiling. Logged, not alerted:
  // the customer's own answers can reach it, and other answers still price.
  | 'price_out_of_range'
  // Spec 0011-08: the relay. Each carries ids only (the outbox row in request_id, the region).
  | 'relay_refused'
  | 'relay_task_failed'
  | 'outbox_stale'
  | 'outbox_unfinished'
  | 'outbox_retry'
  | 'payments_disabled'
  | 'psp_callback_unknown'
  | 'psp_webhook_invalid'
  | 'reconcile_cut'
  | 'relay_handler_failed'
  // Spec 0011-09 AC-9: a card page URL off the active driver's hosts was kept from a payer. The attempt id rides
  // in request_id.
  | 'checkout_url_refused'
  // Spec 0011-11 review F-6: the customer's close info could not be read.
  | 'close_info_refused';

/** The only ids a record may carry: internal ids, never personal data. */
export type LogIds = {
  request_id?: string;
  region?: Region;
  /** The internal user uuid, never an email or a phone. */
  user_id?: string;
  /** A stable code such as `apply_fee_paid:invalid_state` or `handler:TypeError`, never a message (08). */
  code?: string;
};

type Level = 'info' | 'warn' | 'error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[\w:.-]{1,128}$/;
const CODE = /^[A-Za-z_][\w:]{0,79}$/;

/** Keeps only well formed ids, whatever a caller passes at runtime. */
function allowedIds(ids: LogIds): LogIds {
  const out: LogIds = {};
  if (ids.request_id !== undefined && REQUEST_ID.test(ids.request_id)) out.request_id = ids.request_id;
  if (isRegion(ids.region)) out.region = ids.region;
  if (ids.user_id !== undefined && UUID.test(ids.user_id)) out.user_id = ids.user_id;
  if (ids.code !== undefined && CODE.test(ids.code)) out.code = ids.code;
  return out;
}

/** The active trace id; in a job run, the trace that `inJobRun` started for it. */
function correlationId(): string {
  const span = getActiveSpan();
  return span ? span.spanContext().traceId : getCurrentScope().getPropagationContext().traceId;
}

function write(level: Level, event: LogEvent, ids: LogIds = {}): void {
  try {
    const record = { event, correlation_id: correlationId(), ...allowedIds(ids) };
    if (getClient() === undefined) {
      console[level](JSON.stringify({ level, ...record }));
      return;
    }
    logger[level](event, record);
    flushSoon();
  } catch {
    // Logging never breaks a request.
  }
}

export const log = {
  info: (event: LogEvent, ids?: LogIds) => write('info', event, ids),
  warn: (event: LogEvent, ids?: LogIds) => write('warn', event, ids),
  error: (event: LogEvent, ids?: LogIds) => write('error', event, ids),
};

/** Runs one job (the outbox relay, a cron) in a fresh trace, so its records share their own correlation id. */
export function inJobRun<T>(run: () => T): T {
  return startNewTrace(run);
}
