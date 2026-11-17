import 'server-only';

import type { Currency, Region } from '@/lib/region';

/**
 * The one PSP interface (spec 0011-08 AC-1, R-14). Only the relay calls it (rule 3, lint). Amounts cross it as
 * integer minor units (at most `MAX_MINOR`); only an adapter turns them into its PSP's decimal text, and turns
 * the PSP's figures back through `lib/money/parse`. A figure that does not parse is a failed call
 * (`psp_bad_response`), never a guess (rule 4). `lib/psp` never imports `lib/db`: it receives plain values,
 * and the fake receives its store as two functions.
 */

export type PspErrorCode =
  /** The driver refuses every call: `off`, or the iyzico slot before S1 (AC-2, AC-4). */
  | 'psp_not_configured'
  /** The PSP answered something we cannot read: a figure that does not parse, a missing field. */
  | 'psp_bad_response'
  /** No answer within the call's timeout (15 seconds). */
  | 'psp_timeout'
  /** The PSP refused or failed the call; the outbox schedule tries again. */
  | 'psp_error'
  /** A refund of another amount already exists for the payment (AC-11). */
  | 'reconcile_mismatch'
  /** A webhook whose signature does not verify (AC-9). */
  | 'webhook_invalid';

export class PspError extends Error {
  readonly code: PspErrorCode;

  constructor(code: PspErrorCode) {
    super(code);
    this.name = 'PspError';
    this.code = code;
  }
}

export function isPspError(error: unknown): error is PspError {
  return error instanceof PspError;
}

export type FeeKind = 'commission' | 'provider_fee';
export type CheckoutLocale = 'ar' | 'tr' | 'en';

/** Everything a card page needs (AC-4). The buyer's personal data goes to the PSP only, never to a log. */
export type CheckoutRequest = {
  attemptId: string;
  feeId: string;
  feeKind: FeeKind;
  amount: number;
  currency: Currency;
  locale: CheckoutLocale;
  /** `appOrigin()` + `/api/psp/callback`. */
  callbackUrl: string;
  buyer: {
    id: string;
    fullName: string | null;
    email: string | null;
    city: string;
    ip: string | null;
  };
};

export type InitializeResult = { token: string; paymentPageUrl: string };

/** R-2, R-14: a checkout's state. `expired`: the token is past its lifetime or unknown to the PSP. */
export type RetrieveCheckoutResult =
  | {
      status: 'paid';
      pspPaymentId: string;
      amount: number;
      currency: Currency;
      /** The PSP's cut, or null when the PSP does not say (07 books 0 and alerts). */
      pspFee: number | null;
      conversationId: string | null;
      basketId: string | null;
      /** The PSP's answer as received, for the PSP event store (stripped there). Never logged. */
      raw: Record<string, unknown>;
    }
  | { status: 'failed' | 'pending' | 'expired'; raw: Record<string, unknown> };

/** R-14: one payment, for the daily reconcile. */
export type RetrievePaymentResult = {
  status: 'paid' | 'refunded' | 'partially_refunded' | 'failed';
  amount: number;
  currency: Currency;
  pspFee: number | null;
  refundedAmount: number;
  raw: Record<string, unknown>;
};

export type RefundRequest = { pspPaymentId: string; amount: number; currency: Currency };

/** AC-11: `existing` when the PSP already held a refund of that amount and no new call was made. */
export type RefundResult = { pspRefundId: string; existing: boolean };

/** AC-9, R-15: a verified webhook. `eventKey` is the PSP's event id, else the hex SHA-256 of the raw body. */
export type WebhookEvent = {
  eventKey: string;
  token: string | null;
  pspPaymentId: string | null;
  payload: Record<string, unknown>;
};

export type WebhookInput = { rawBody: string; headers: Headers };

export interface PspAdapter {
  readonly name: 'off' | 'fake' | 'iyzico';
  /** The region a PSP event belongs to when nothing in it names one (AC-9). */
  readonly homeRegion: Region;
  /** The card page hosts (AC-21), from `lib/payments/checkout-hosts.ts`. */
  readonly checkoutHosts: readonly string[];
  initializeCheckout(request: CheckoutRequest): Promise<InitializeResult>;
  retrieveCheckout(token: string): Promise<RetrieveCheckoutResult>;
  retrievePayment(pspPaymentId: string): Promise<RetrievePaymentResult>;
  refundPayment(request: RefundRequest): Promise<RefundResult>;
  verifyWebhook(input: WebhookInput): Promise<WebhookEvent>;
}
