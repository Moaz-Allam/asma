import 'server-only';

import type { Db } from '@/lib/db/types';
import { raiseAlert } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import type { PspAdapter } from '@/lib/psp';
import { isRegion } from '@/lib/region';

import { agreementGaveUp, renderAgreement } from './agreement';
import { ALERTING_CODES, call, RelayDbError } from './db';
import {
  initializeCheckout,
  initializeGaveUp,
  MAX_TRIES,
  refundGaveUp,
  refundPayment,
  verifyPayment,
  type Outcome,
  type OutboxRow,
} from './handlers';

/**
 * `drain` (spec 0011-08 AC-5, AC-0, R-3): claim at most 5 rows per `claim_outbox` call, run them at once, and
 * check a 40 second deadline before each claim. No handler runs longer than 60 seconds; a row the run could not
 * finish is logged `outbox_unfinished` and its 2 minute lease runs out, so another run claims it again (every
 * handler is safe to run twice). A `stale` finish means another relay owns the row now.
 */

export const CLAIM_LIMIT = 5;
// Both fit inside the route's 60 second maxDuration (review 2026-11-17): the last claim at 25 seconds, and a
// handler (at most two PSP calls of 15 seconds) cut at 30, so a row is left `outbox_unfinished` for its lease to
// run out rather than killed with the function. Tighter than R-3's 40 and 60, which only fit the 2 minute lease.
export const DRAIN_DEADLINE_MS = 25_000;
export const HANDLER_LIMIT_MS = 30_000;

export type DrainOptions = {
  db: Db;
  psp: PspAdapter;
  worker: string;
  now?: () => number;
  deadlineMs?: number;
  handlerMs?: number;
};

export type DrainResult = { ran: number; failed: number; unfinished: number };

const UNFINISHED = Symbol('unfinished');

async function handle(db: Db, psp: PspAdapter, row: OutboxRow): Promise<Outcome> {
  switch (row.kind) {
    case 'checkout.initialize':
      return initializeCheckout(db, psp, row);
    case 'payment.verify':
      return verifyPayment(db, psp, row);
    case 'refund.request':
      return refundPayment(db, psp, row);
    case 'agreement.render':
      // Spec 0011-20 AC-6: the service agreement PDF, rendered and stored here, never in a request path.
      return renderAgreement(db, row);
    default:
      // claim_outbox leaves email.send rows to the mail lane (spec 0011-13 R-12), so only an unknown kind lands
      // here; it runs out of tries and alerts outbox_failed.
      return { ok: false, error: 'kind_not_built' };
  }
}

/** A handler, with a 07 refusal turned into a retry (and an alert on the first and the last try, AC-19). */
async function runHandler(db: Db, psp: PspAdapter, row: OutboxRow): Promise<Outcome> {
  try {
    return await handle(db, psp, row);
  } catch (error) {
    if (error instanceof RelayDbError) {
      if (ALERTING_CODES.includes(error.code) && (row.attempts === 1 || row.attempts >= MAX_TRIES)) {
        raiseAlert('idempotency_conflict', {
          recordId: row.id,
          region: isRegion(row.region) ? row.region : undefined,
        });
      }
      log.warn('relay_handler_failed', { request_id: row.id, code: `${error.fn}:${error.code}` });
      return { ok: false, error: `${error.fn}:${error.code}` };
    }
    // The class name only, never the message, which can carry values (review 2026-11-17).
    const name = error instanceof Error ? error.name : 'unknown';
    log.error('relay_handler_failed', { request_id: row.id, code: `handler:${name}` });
    return { ok: false, error: `handler_error:${name}`.slice(0, 100) };
  }
}

async function giveUp(db: Db, row: OutboxRow): Promise<void> {
  try {
    if (row.kind === 'checkout.initialize') await initializeGaveUp(db, row);
    if (row.kind === 'refund.request') await refundGaveUp(db, row);
    if (row.kind === 'agreement.render') await agreementGaveUp(db, row);
  } catch {
    // The heartbeat covers it: the failed row is alerted there (R-12).
  }
}

async function runRow(
  db: Db,
  psp: PspAdapter,
  row: OutboxRow,
  handlerMs: number,
): Promise<'ok' | 'failed' | 'unfinished'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof UNFINISHED>((resolve) => {
    timer = setTimeout(() => resolve(UNFINISHED), handlerMs);
  });
  const outcome = await Promise.race([runHandler(db, psp, row), limit]).finally(() => clearTimeout(timer));
  const region = isRegion(row.region) ? row.region : undefined;
  if (outcome === UNFINISHED) {
    log.warn('outbox_unfinished', { request_id: row.id, region });
    return 'unfinished';
  }
  if (!outcome.ok && row.attempts >= MAX_TRIES) await giveUp(db, row);
  if (!outcome.ok) log.warn('outbox_retry', { request_id: row.id, region });
  try {
    const finished = await call<{ stale?: boolean }>(db, 'finish_outbox', {
      p_id: row.id,
      p_ok: outcome.ok,
      p_error: outcome.ok ? null : outcome.error.slice(0, 1000),
      p_claim_token: row.claim_token,
    });
    if (finished?.stale === true) log.info('outbox_stale', { request_id: row.id, region });
  } catch {
    log.error('relay_task_failed', { request_id: row.id, region });
    return 'unfinished';
  }
  return outcome.ok ? 'ok' : 'failed';
}

export async function runDrain(options: DrainOptions): Promise<DrainResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? DRAIN_DEADLINE_MS);
  const handlerMs = options.handlerMs ?? HANDLER_LIMIT_MS;
  const result: DrainResult = { ran: 0, failed: 0, unfinished: 0 };
  while (now() < deadline) {
    const rows = await call<OutboxRow[]>(options.db, 'claim_outbox', {
      p_limit: CLAIM_LIMIT,
      p_worker: options.worker,
    });
    if (!Array.isArray(rows) || rows.length === 0) break;
    const outcomes = await Promise.all(rows.map((row) => runRow(options.db, options.psp, row, handlerMs)));
    for (const outcome of outcomes) {
      if (outcome === 'ok') result.ran += 1;
      else if (outcome === 'failed') result.failed += 1;
      else result.unfinished += 1;
    }
  }
  return result;
}
