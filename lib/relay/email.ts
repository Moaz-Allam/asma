import 'server-only';

import type { Db } from '@/lib/db/types';
import {
  EmailContextSchema,
  EmailRenderError,
  renderEmail,
  type EmailContext,
  type EmailDriver,
  type FinishOutcome,
  type RenderedEmail,
  type SendResult,
} from '@/lib/email';
import { log } from '@/lib/observability/log';

import { call } from './db';

/**
 * The relay's `email` task (spec 0011-13 AC-8, R-8, R-11, R-12): the mail lane, apart from the payment lane so a
 * burst of mail never delays a payment. Claims 10 rows at a time through `claim_email_outbox`, checks a 25 second
 * deadline before each claim, asks `email_context` whether each mail still makes sense, renders and sends it with
 * the outbox key as the Idempotency-Key, and ends it through `finish_email`. Sends are paced to 2 a second
 * (Resend's default limit); skips cost nothing. Logs carry only the outbox id, the template and the outcome
 * (AC-9): never an address, a subject or a body.
 */

export const EMAIL_CLAIM_LIMIT = 10;
export const EMAIL_DEADLINE_MS = 25_000;
export const EMAIL_SEND_INTERVAL_MS = 500;
// finish_email stores a detail only in this shape (D192); the relay sends nothing else.
const SAFE_DETAIL = /^[a-z0-9_:]{1,100}$/;

type EmailRow = { id: string; idempotency_key: string; claim_token: string; attempts: number };

export type EmailRunOptions = {
  db: Db;
  driver: EmailDriver;
  worker: string;
  origin: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  deadlineMs?: number;
};

export type EmailRunResult = { sent: number; skipped: number; failed: number; retried: number };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function finish(db: Db, row: EmailRow, outcome: FinishOutcome, detail?: string): Promise<void> {
  try {
    const done = await call<{ stale?: boolean }>(db, 'finish_email', {
      p_id: row.id,
      p_outcome: outcome,
      p_claim_token: row.claim_token,
      p_detail: detail ?? null,
    });
    if (done?.stale === true) log.info('email_stale_finish', { request_id: row.id });
  } catch {
    // The lease runs out and another run takes the row again; Resend's key keeps that from sending twice.
    log.error('email_finish_failed', { request_id: row.id });
  }
}

export async function runEmail(options: EmailRunOptions): Promise<EmailRunResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + (options.deadlineMs ?? EMAIL_DEADLINE_MS);
  const result: EmailRunResult = { sent: 0, skipped: 0, failed: 0, retried: 0 };
  let lastSend = Number.NEGATIVE_INFINITY;

  while (now() < deadline) {
    const rows = await call<EmailRow[]>(options.db, 'claim_email_outbox', {
      p_limit: EMAIL_CLAIM_LIMIT,
      p_worker: options.worker,
    });
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      let context: EmailContext;
      try {
        context = EmailContextSchema.parse(
          await call<unknown>(options.db, 'email_context', { p_outbox_id: row.id }),
        );
      } catch {
        // A refusal or a shape we do not know: retried on 07's schedule, failed and alerted after the sixth try.
        log.warn('email_context_failed', { request_id: row.id });
        await finish(options.db, row, 'retry', 'context_invalid');
        result.retried += 1;
        continue;
      }
      if (context.status === 'skip') {
        await finish(options.db, row, context.reason);
        log.info('email_finished', { request_id: row.id, code: context.reason });
        result.skipped += 1;
        continue;
      }
      if (options.driver.name === 'off') {
        await finish(options.db, row, 'email_off');
        log.info('email_finished', { request_id: row.id, code: `${context.template}:email_off` });
        result.skipped += 1;
        continue;
      }

      let rendered: RenderedEmail;
      try {
        rendered = renderEmail(context, options.origin);
      } catch (error) {
        const code = error instanceof EmailRenderError ? error.code : 'render_failed';
        await finish(
          options.db,
          row,
          'rejected',
          `render:${code}`.replace(/[^a-z0-9_:]/g, '_').slice(0, 100),
        );
        log.error('email_render_failed', { request_id: row.id, code: context.template });
        result.failed += 1;
        continue;
      }

      const wait = lastSend + EMAIL_SEND_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      lastSend = now();
      let sent: SendResult;
      try {
        sent = await options.driver.send({
          ...rendered,
          to: context.email,
          key: row.idempotency_key,
          template: context.template,
          locale: context.locale,
        });
      } catch {
        sent = { outcome: 'retry', detail: 'driver_error' };
      }
      // R-11: only a code goes on (`http_422:validation_error`); anything else could quote the address.
      const detail = sent.detail !== undefined && SAFE_DETAIL.test(sent.detail) ? sent.detail : undefined;
      await finish(options.db, row, sent.outcome, detail);
      log.info('email_finished', { request_id: row.id, code: `${context.template}:${sent.outcome}` });
      if (sent.outcome === 'sent' || sent.outcome === 'already_sent') result.sent += 1;
      else if (sent.outcome === 'retry') result.retried += 1;
      else if (sent.outcome === 'rejected') result.failed += 1;
      else result.skipped += 1;
    }
  }
  return result;
}
