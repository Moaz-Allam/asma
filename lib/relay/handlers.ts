import 'server-only';

import type { Db } from '@/lib/db/types';
import { isEnabled } from '@/lib/flags';
import { appOrigin } from '@/lib/http/origin';
import { raiseAlert, type AlertReason } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import { isAllowedCheckoutUrl } from '@/lib/payments/checkout-url';
import { isPspError, type CheckoutLocale, type FeeKind, type PspAdapter } from '@/lib/psp';
import { isRegion, type Currency, type Region } from '@/lib/region';

import { call, RelayDbError, type DbCode } from './db';

/** Spec 0011-09 R-2: the settings refusals of apply_fee_paid that never become a late refund. */
const SETTINGS_CODES: readonly DbCode[] = ['checkout_settings_invalid', 'unlock_settings_invalid'];

/**
 * The three outbox kinds the relay carries out (spec 0011-08 AC-7, AC-10, AC-11). Each handler is safe to run
 * twice (R-3): a second run finds the row's work already done and changes nothing. A handler answers `done`
 * (finish the row), or `retry` with a short error code (the outbox schedule tries again). The relay never
 * decides money: it hands verified facts to 07's functions, which decide.
 */

export type OutboxRow = {
  id: string;
  kind: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  region: string;
  /** Returned to finish_outbox exactly as received, never through a Date (AC-0). */
  claim_token: string;
};

export type Outcome = { ok: true } | { ok: false; error: string };

export const MAX_TRIES = 6;
const DONE: Outcome = { ok: true };
const retry = (error: string): Outcome => ({ ok: false, error });

type Context = {
  attempt_id: string;
  attempt_status: 'queued' | 'ready' | 'succeeded' | 'failed' | 'abandoned';
  locale: CheckoutLocale;
  psp_token: string | null;
  region: Region;
  attempt_age_seconds: number;
  payer_ip: string | null;
  fee_payment_id: string;
  fee_kind: FeeKind;
  fee_status: 'pending' | 'paid' | 'refunded';
  amount: number;
  currency: Currency;
  payer_id: string;
  full_name: string | null;
  email: string | null;
  settings: { hold_minutes: number; buyer_city: string } | null;
};

type ApplyResult = {
  status?: 'paid' | 'late' | 'refunded';
  alerts?: unknown;
  fee_payment_id?: string;
  fee_refund_id?: string | null;
  replayed?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * R-13: every alert an apply returns is raised, replays included; the fingerprint joins repeats in one issue
 * per record, so a crash between the commit and the alert never loses one.
 */
function raiseApplyAlerts(
  result: ApplyResult,
  records: { fee?: string; refund?: string },
  region: Region,
): void {
  const alerts = Array.isArray(result.alerts) ? result.alerts : [];
  for (const reason of alerts) {
    if (reason === 'late_payment_refunded' || reason === 'reconcile_mismatch') {
      const recordId =
        (reason === 'late_payment_refunded' ? records.fee : (records.fee ?? records.refund)) ?? 'unknown';
      raiseAlert(reason as AlertReason, { recordId, region });
    }
  }
}

const unfinished = (status: Context['attempt_status']) => status !== 'queued' && status !== 'ready';

async function context(db: Db, attemptId: string): Promise<Context> {
  return call<Context>(db, 'checkout_context', { p_attempt_id: attemptId });
}

async function fail(db: Db, attemptId: string, reason: string): Promise<void> {
  await call(db, 'mark_checkout_failed', { p_attempt_id: attemptId, p_reason: reason });
}

/** AC-7, R-4, AC-18: open the card page, or fail the attempt with its reason and no PSP call. */
export async function initializeCheckout(db: Db, psp: PspAdapter, row: OutboxRow): Promise<Outcome> {
  const attemptId = row.payload.attempt_id;
  if (!isUuid(attemptId)) return retry('payload_invalid');
  const ctx = await context(db, attemptId);
  if (ctx.attempt_status !== 'queued') return DONE;
  if (!isRegion(ctx.region)) return retry('region_invalid');

  // Read once per row, never cached; fails closed (AC-18).
  if (!(await isEnabled('payments_enabled', ctx.region, db))) {
    await fail(db, attemptId, 'payments_disabled');
    log.info('payments_disabled', { request_id: row.id, region: ctx.region });
    return DONE;
  }
  if (ctx.fee_status !== 'pending') {
    await fail(db, attemptId, 'fee_not_pending');
    return DONE;
  }
  if (ctx.settings === null) {
    raiseAlert('checkout_settings_invalid', { recordId: attemptId, region: ctx.region });
    return retry('checkout_settings_invalid');
  }
  if (ctx.attempt_age_seconds > ctx.settings.hold_minutes * 60) {
    await fail(db, attemptId, 'init_late');
    return DONE;
  }

  let page: { token: string; paymentPageUrl: string };
  try {
    page = await psp.initializeCheckout({
      attemptId,
      feeId: ctx.fee_payment_id,
      feeKind: ctx.fee_kind,
      amount: ctx.amount,
      currency: ctx.currency,
      locale: ctx.locale,
      callbackUrl: `${appOrigin()}/api/psp/callback`,
      buyer: {
        id: ctx.payer_id,
        fullName: ctx.full_name,
        email: ctx.email,
        city: ctx.settings.buyer_city,
        ip: ctx.payer_ip,
      },
    });
  } catch (error) {
    if (isPspError(error) && error.code === 'psp_not_configured') {
      await fail(db, attemptId, 'psp_not_configured');
      raiseAlert('psp_not_configured', { recordId: attemptId, region: ctx.region });
      return DONE;
    }
    if (isPspError(error) && error.code === 'psp_bad_response' && row.attempts === 1) {
      raiseAlert('psp_bad_response', { recordId: attemptId, region: ctx.region });
    }
    return retry(isPspError(error) ? error.code : 'psp_error');
  }

  // AC-21: a card page URL off the driver's hosts is never stored, and never shown.
  if (!isAllowedCheckoutUrl(page.paymentPageUrl, psp.checkoutHosts)) {
    await fail(db, attemptId, 'url_refused');
    raiseAlert('psp_bad_response', { recordId: attemptId, region: ctx.region });
    return DONE;
  }
  await call(db, 'mark_checkout_ready', {
    p_attempt_id: attemptId,
    p_token: page.token,
    p_url: page.paymentPageUrl,
  });
  return DONE;
}

/** The last try of an initialize row failed: the attempt fails with `init_failed` (AC-7). */
export async function initializeGaveUp(db: Db, row: OutboxRow): Promise<void> {
  const attemptId = row.payload.attempt_id;
  if (isUuid(attemptId)) await fail(db, attemptId, 'init_failed');
}

/**
 * AC-10, R-1, R-2: ask the PSP what happened on this attempt's card page and hand a paid fact to 07. Runs when
 * payments are off (D172). A finished attempt (failed, abandoned, succeeded) is checked for a payment only.
 */
export async function verifyPayment(db: Db, psp: PspAdapter, row: OutboxRow): Promise<Outcome> {
  const attemptId = row.payload.attempt_id;
  const final = row.payload.final === true;
  if (!isUuid(attemptId)) return retry('payload_invalid');
  const ctx = await context(db, attemptId);
  if (ctx.psp_token === null) return DONE;
  if (!isRegion(ctx.region)) return retry('region_invalid');

  let result: Awaited<ReturnType<PspAdapter['retrieveCheckout']>>;
  try {
    result = await psp.retrieveCheckout(ctx.psp_token);
  } catch (error) {
    if (isPspError(error) && (error.code === 'psp_not_configured' || error.code === 'psp_bad_response')) {
      if (row.attempts === 1) raiseAlert(error.code, { recordId: attemptId, region: ctx.region });
    }
    return retry(isPspError(error) ? error.code : 'psp_error');
  }

  const paymentId = result.status === 'paid' ? result.pspPaymentId : 'none';
  await call(db, 'record_psp_event', {
    p_source: 'retrieve',
    p_event_key: `retrieve:${attemptId}:${result.status}:${paymentId}`.slice(0, 200),
    p_payload: result.raw,
    p_region: ctx.region,
  });

  if (result.status === 'paid') {
    // The PSP must echo our ids; a payment for another attempt or fee is never applied here.
    if (result.conversationId !== attemptId || result.basketId !== ctx.fee_payment_id) {
      raiseAlert('reconcile_mismatch', { recordId: ctx.fee_payment_id, region: ctx.region });
      return DONE;
    }
    let applied: ApplyResult;
    try {
      applied = await call<ApplyResult>(db, 'apply_fee_paid', {
        p_fee_payment_id: ctx.fee_payment_id,
        p_attempt_id: attemptId,
        p_psp_payment_id: result.pspPaymentId,
        p_amount: result.amount,
        p_currency: result.currency,
        p_psp_fee: result.pspFee,
      });
    } catch (error) {
      // Spec 0011-09 R-2: a setting the accept check or the transition reads is missing. The money stays
      // untouched; alert at once (and when the row fails) and retry by the schedule until it is fixed.
      if (error instanceof RelayDbError && SETTINGS_CODES.includes(error.code)) {
        if (row.attempts === 1 || row.attempts >= MAX_TRIES) {
          raiseAlert(error.code as AlertReason, { recordId: ctx.fee_payment_id, region: ctx.region });
        }
        return retry(error.code);
      }
      throw error;
    }
    raiseApplyAlerts(applied, { fee: ctx.fee_payment_id }, ctx.region);
    // Spec 0011-09 AC-8, A-7: a late payment closes its attempt, so the pages stop waiting. A succeeded or
    // already failed attempt is left as it is (R-3); a replay changes nothing.
    if (applied.status === 'late') await fail(db, attemptId, 'late_payment');
    return DONE;
  }
  if (unfinished(ctx.attempt_status)) return DONE;
  if (result.status === 'failed') {
    await fail(db, attemptId, 'psp_failed');
    return DONE;
  }
  if (result.status === 'expired') {
    // R-2: abandon only on a final check of a dead token; an earlier expired answer waits for it.
    if (final) await call(db, 'abandon_checkout', { p_attempt_id: attemptId });
    return DONE;
  }
  // A reconcile check that finds the page still pending finishes: the next 15 minute window asks again, so its
  // own retries would only turn every abandoned card page into failed rows and alerts (review Major 1). A callback
  // or webhook check retries by the schedule.
  return row.payload.origin === 'reconcile' ? DONE : retry('pending');
}

/**
 * AC-11: refund a payment, once. The adapter reads the payment's refunds first on every try (no refund
 * idempotency key exists at the PSP); then 07 stores the refund id and `done` in one statement; only then is the
 * row finished. Runs when payments are off (D172).
 */
export async function refundPayment(db: Db, psp: PspAdapter, row: OutboxRow): Promise<Outcome> {
  const { fee_refund_id: refundId, psp_payment_id: pspPaymentId, amount, currency } = row.payload;
  if (
    !isUuid(refundId) ||
    typeof pspPaymentId !== 'string' ||
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    (currency !== 'TRY' && currency !== 'SAR')
  ) {
    return retry('payload_invalid');
  }
  const region: Region = isRegion(row.region) ? row.region : 'TR';

  let refunded: { pspRefundId: string };
  try {
    refunded = await psp.refundPayment({ pspPaymentId, amount, currency });
  } catch (error) {
    if (isPspError(error) && error.code === 'reconcile_mismatch') {
      raiseAlert('reconcile_mismatch', { recordId: refundId, region });
    } else if (
      isPspError(error) &&
      (error.code === 'psp_not_configured' || error.code === 'psp_bad_response')
    ) {
      if (row.attempts === 1) raiseAlert(error.code, { recordId: refundId, region });
    }
    return retry(isPspError(error) ? error.code : 'psp_error');
  }
  const applied = await call<ApplyResult>(db, 'apply_fee_refunded', {
    p_fee_refund_id: refundId,
    p_psp_refund_id: refunded.pspRefundId,
  });
  raiseApplyAlerts(applied, { refund: refundId }, region);
  return DONE;
}

/** The last try of a refund row failed: the refund is marked failed and alerted (AC-11). */
export async function refundGaveUp(db: Db, row: OutboxRow): Promise<void> {
  const refundId = row.payload.fee_refund_id;
  if (!isUuid(refundId)) return;
  await call(db, 'mark_refund_failed', { p_fee_refund_id: refundId });
  raiseAlert('refund_failed', { recordId: refundId, region: isRegion(row.region) ? row.region : undefined });
}
