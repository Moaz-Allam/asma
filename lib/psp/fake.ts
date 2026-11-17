import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { checkoutHostsFor } from '@/lib/payments/checkout-hosts';
import { MAX_MINOR } from '@/lib/money/parse';
import type { Currency } from '@/lib/region';

import {
  PspError,
  type CheckoutRequest,
  type InitializeResult,
  type PspAdapter,
  type RefundRequest,
  type RefundResult,
  type RetrieveCheckoutResult,
  type RetrievePaymentResult,
  type WebhookEvent,
  type WebhookInput,
} from './types';

/**
 * The fake PSP (spec 0011-08 AC-15), for tests, development and previews; never production (lib/deployment.ts).
 * Deterministic: every fact it returns follows from its token, the outcome chosen on its card page, and its
 * store. The token carries the attempt, the fee, the amount, the currency and when it was issued, so a
 * retrieve can echo them; the store (two functions over `fake_psp_set` and `fake_psp_get`, given by the relay,
 * because `lib/psp` never imports `lib/db`) holds the outcome, a retrieve counter and the refunds.
 *
 * Outcomes: success; failure; pending (two pending retrieves, then paid); duplicate (a second payment id for
 * the same token on the next retrieve); mismatch (one minor unit more than asked); webhook only (paid, but the
 * card page posts a signed webhook instead of the callback). A token with no outcome is pending for 30
 * minutes, then expired (R-2). The PSP's cut is 3 percent, rounded down.
 */

export const FAKE_TOKEN_LIFETIME_SECONDS = 30 * 60;
/** A fixed TEST secret, public on purpose: the fake signs its webhooks with it (AC-15). Never a real secret. */
export const FAKE_WEBHOOK_SECRET = 'fake-psp-webhook-test-secret';
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
export const FAKE_OUTCOMES = [
  'success',
  'failure',
  'pending',
  'duplicate',
  'mismatch',
  'webhook_only',
] as const;
export type FakeOutcome = (typeof FAKE_OUTCOMES)[number];

export type FakeState = {
  outcome: FakeOutcome;
  retrieves: number;
  refunds: Record<string, { id: string; amount: number }>;
};

/** The fake's store, given by the relay (`lib/relay/fake-store.ts`). */
export type FakeStore = {
  get(token: string): Promise<unknown>;
  set(token: string, state: FakeState): Promise<void>;
};

export type FakeToken = {
  attemptId: string;
  feeId: string;
  amount: number;
  currency: Currency;
  issuedAt: number;
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN = new RegExp(`^fk1_(${UUID})_(${UUID})_([1-9][0-9]{0,8})_(TRY|SAR)_([0-9]{10})$`);
// A fake payment id carries its token (`fp<n>_<token>`), so a refund or a daily retrieve finds the fake's state.
// The fake's token is not a secret (anyone may pay on the fake); an iyzico payment id never carries a token.
const PAYMENT = /^fp([12])_(fk1_[0-9a-zA-Z_-]{1,200})$/;

/** The token inside a fake payment id (`fp<n>_<token>`), with the token parsed, or null. */
function parsePayment(pspPaymentId: string): { token: string; parsed: FakeToken } | null {
  const token = PAYMENT.exec(pspPaymentId)?.[2];
  const parsed = token === undefined ? null : parseFakeToken(token);
  return token === undefined || parsed === null ? null : { token, parsed };
}

export function makeFakeToken(token: FakeToken): string {
  return `fk1_${token.attemptId}_${token.feeId}_${token.amount}_${token.currency}_${token.issuedAt}`;
}

export function parseFakeToken(token: string): FakeToken | null {
  const match = typeof token === 'string' ? TOKEN.exec(token) : null;
  if (match === null) return null;
  const [, attemptId = '', feeId = '', amountText = '', currency = '', issuedAt = ''] = match;
  const amount = Number(amountText);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_MINOR) return null;
  return { attemptId, feeId, amount, currency: currency as Currency, issuedAt: Number(issuedAt) };
}

function parseState(value: unknown): FakeState | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!(FAKE_OUTCOMES as readonly unknown[]).includes(v.outcome)) return null;
  const retrieves = typeof v.retrieves === 'number' && Number.isSafeInteger(v.retrieves) ? v.retrieves : 0;
  const refunds: FakeState['refunds'] = {};
  if (typeof v.refunds === 'object' && v.refunds !== null) {
    for (const [key, refund] of Object.entries(v.refunds as Record<string, unknown>)) {
      const r = refund as Record<string, unknown> | null;
      if (r && typeof r.id === 'string' && typeof r.amount === 'number')
        refunds[key] = { id: r.id, amount: r.amount };
    }
  }
  return { outcome: v.outcome as FakeOutcome, retrieves, refunds };
}

export function fakeSignature(rawBody: string): string {
  return createHmac('sha256', FAKE_WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The PSP's cut on a paid amount: 3 percent, rounded down, in integer arithmetic (rule 4). */
export function fakeCut(amount: number): number {
  return Math.floor((amount * 3) / 100);
}

export function createFakeAdapter(options: {
  store: FakeStore;
  origin: string;
  now?: () => number;
}): PspAdapter {
  const { store, origin } = options;
  const nowSeconds = () => Math.floor((options.now ?? Date.now)() / 1000);

  const paidAmount = (token: FakeToken, state: FakeState) =>
    token.amount + (state.outcome === 'mismatch' ? 1 : 0);

  async function initializeCheckout(request: CheckoutRequest): Promise<InitializeResult> {
    if (!Number.isSafeInteger(request.amount) || request.amount < 1 || request.amount > MAX_MINOR) {
      throw new PspError('psp_bad_response');
    }
    const token = makeFakeToken({
      attemptId: request.attemptId,
      feeId: request.feeId,
      amount: request.amount,
      currency: request.currency,
      issuedAt: nowSeconds(),
    });
    if (parseFakeToken(token) === null) throw new PspError('psp_bad_response');
    return { token, paymentPageUrl: `${origin}/${request.locale}/dev/fake-checkout/${token}` };
  }

  async function retrieveCheckout(token: string): Promise<RetrieveCheckoutResult> {
    const parsed = parseFakeToken(token);
    if (parsed === null) return { status: 'expired', raw: { status: 'failure', errorCode: 'token_unknown' } };
    const state = parseState(await store.get(token));
    if (state === null) {
      const expired = nowSeconds() - parsed.issuedAt > FAKE_TOKEN_LIFETIME_SECONDS;
      return expired
        ? { status: 'expired', raw: { status: 'failure', errorCode: 'token_expired' } }
        : { status: 'pending', raw: { status: 'success', paymentStatus: 'INIT_THREEDS', token } };
    }
    if (state.outcome === 'failure') {
      return { status: 'failed', raw: { status: 'success', paymentStatus: 'FAILURE', token } };
    }
    let payment = 1;
    if (state.outcome === 'pending') {
      if (state.retrieves < 2) {
        await store.set(token, { ...state, retrieves: state.retrieves + 1 });
        return { status: 'pending', raw: { status: 'success', paymentStatus: 'INIT_THREEDS', token } };
      }
    } else if (state.outcome === 'duplicate') {
      payment = state.retrieves >= 1 ? 2 : 1;
      await store.set(token, { ...state, retrieves: state.retrieves + 1 });
    }
    const amount = paidAmount(parsed, state);
    const pspPaymentId = `fp${payment}_${token}`;
    const pspFee = fakeCut(amount);
    return {
      status: 'paid',
      pspPaymentId,
      amount,
      currency: parsed.currency,
      pspFee,
      conversationId: parsed.attemptId,
      basketId: parsed.feeId,
      raw: {
        status: 'success',
        paymentStatus: 'SUCCESS',
        paymentId: pspPaymentId,
        paidPrice: amount,
        currency: parsed.currency,
        conversationId: parsed.attemptId,
        basketId: parsed.feeId,
        token,
      },
    };
  }

  async function retrievePayment(pspPaymentId: string): Promise<RetrievePaymentResult> {
    const payment = parsePayment(pspPaymentId);
    if (payment === null) throw new PspError('psp_bad_response');
    const { token, parsed } = payment;
    const state = parseState(await store.get(token));
    if (state === null || state.outcome === 'failure') {
      return {
        status: 'failed',
        amount: 0,
        currency: parsed.currency,
        pspFee: null,
        refundedAmount: 0,
        raw: {},
      };
    }
    const amount = paidAmount(parsed, state);
    const refunded = state.refunds[pspPaymentId]?.amount ?? 0;
    const status = refunded === 0 ? 'paid' : refunded >= amount ? 'refunded' : 'partially_refunded';
    return {
      status,
      amount,
      currency: parsed.currency,
      pspFee: fakeCut(amount),
      refundedAmount: refunded,
      raw: { paymentId: pspPaymentId, paymentStatus: status.toUpperCase(), paidPrice: amount },
    };
  }

  async function refundPayment(request: RefundRequest): Promise<RefundResult> {
    const payment = parsePayment(request.pspPaymentId);
    if (payment === null) throw new PspError('psp_bad_response');
    const { token, parsed } = payment;
    // The PSP's existing refunds first, on every try (AC-11): a refund is never made twice.
    const state = parseState(await store.get(token));
    if (state === null || state.outcome === 'failure') throw new PspError('psp_bad_response');
    const existing = state.refunds[request.pspPaymentId];
    if (existing !== undefined) {
      if (existing.amount !== request.amount) throw new PspError('reconcile_mismatch');
      return { pspRefundId: existing.id, existing: true };
    }
    if (request.amount !== paidAmount(parsed, state) || request.currency !== parsed.currency) {
      throw new PspError('psp_bad_response');
    }
    const id = `fr_${request.pspPaymentId}`;
    await store.set(token, {
      ...state,
      refunds: { ...state.refunds, [request.pspPaymentId]: { id, amount: request.amount } },
    });
    return { pspRefundId: id, existing: false };
  }

  async function verifyWebhook(input: WebhookInput): Promise<WebhookEvent> {
    const signature = input.headers.get(FAKE_SIGNATURE_HEADER) ?? '';
    if (!sameText(signature, fakeSignature(input.rawBody))) throw new PspError('webhook_invalid');
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      throw new PspError('webhook_invalid');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw new PspError('webhook_invalid');
    const b = body as Record<string, unknown>;
    const text = (value: unknown, max: number) =>
      typeof value === 'string' && value.length >= 1 && value.length <= max ? value : null;
    return {
      eventKey: text(b.eventId, 200) ?? createHash('sha256').update(input.rawBody, 'utf8').digest('hex'),
      token: text(b.token, 500),
      pspPaymentId: text(b.paymentId, 200),
      payload: b,
    };
  }

  return {
    name: 'fake',
    homeRegion: 'TR',
    checkoutHosts: checkoutHostsFor('fake', origin),
    initializeCheckout,
    retrieveCheckout,
    retrievePayment,
    refundPayment,
    verifyWebhook,
  };
}
