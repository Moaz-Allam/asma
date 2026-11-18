import 'server-only';

import { captureMessage, getClient, withScope } from '@sentry/nextjs';

import { appEnv } from '@/lib/deployment';
import { flushSoon } from '@/lib/observability/server';
import type { Region } from '@/lib/region';

/**
 * `raiseAlert` (spec 0004 AC-11, D67): one Sentry event tagged `alert`, fingerprinted by reason, record
 * id and environment, so repeats for the same record join one issue, and a preview alert never hides
 * the first production one inside an existing issue (D84). Two Sentry alert rules (production only)
 * email the owner: one on a new or returning alert issue, one when an issue passes 10 events in 15
 * minutes (D80).
 *
 * The send is flushed with `after()` before the function freezes. Never throws; without the SDK it
 * mirrors to the console.
 */

/** Every alert reason. 00b defines the first; each money position adds its own. */
export type AlertReason =
  | 'flag_read_failed'
  // Spec 0007 AC-8, AC-24: a region's rounding unit or price multiple is missing or malformed, so every quote
  // in that region refuses. The record is the service id that was being quoted.
  | 'pricing_settings_invalid'
  // Spec 0008 AC-1b, AC-11: a region's schedule, open cap or quote limit setting is missing or malformed, so no
  // request can be posted there. The record is the service id being quoted, or `catalog` for the form read.
  | 'request_settings_invalid'
  // Spec 0009 AC-1, AC-11: a region's applicant cap or hourly apply limit is missing or malformed, so no provider
  // there can apply or read the feed. The record is the database function that refused.
  | 'apply_settings_invalid'
  // Spec 0010 AC-8: a region's payment window is missing or malformed, so no customer there can choose. The
  // record is the request id.
  | 'choose_settings_invalid'
  // Spec 0011-07 AC-0, AC-1, R-3: a region's provider fee settings or fee floor is missing or malformed, so no
  // customer there can choose, quote or post. The record is the request id, the service id, or `catalog`.
  | 'fee_settings_invalid'
  // Spec 0011-08 AC-19 (R13, R-3 of 07), raised by the relay. Each record is named:
  // A 07 function answered idempotency_conflict, validation_failed, not_found or invalid_state (on the first try
  // and when the row fails). The record is the outbox row id.
  | 'idempotency_conflict'
  // apply_fee_paid booked a payment as late and queued its refund. The record is the fee id.
  | 'late_payment_refunded'
  // A verified PSP fact differs from ours: the echoed ids, the amount, the currency, the PSP's cut, a refund of
  // another amount, a day not finished. The record is the fee or refund id, or `<region>:<day>:unfinished`.
  | 'reconcile_mismatch'
  // A refund ran out of tries. The record is the fee refund id.
  | 'refund_failed'
  // The oldest due outbox row waited more than 5 minutes. The record is `outbox`.
  | 'relay_stalled'
  // ledger_check found an imbalance. The record is `<region>:<check>:<ref>`.
  | 'ledger_unbalanced'
  // An outbox row ran out of tries. The record is the outbox row id.
  | 'outbox_failed'
  // A checkout was asked of a driver that refuses (`off`, or the iyzico slot before S1). The record is the
  // attempt id.
  | 'psp_not_configured'
  // The PSP answered something we cannot read, or a card page URL off its hosts. The record is the attempt or
  // refund id.
  | 'psp_bad_response'
  // A region's checkout hold or buyer city is missing or malformed, or (spec 0011-09 AC-1, R-6) its checkout limit.
  // The record is the attempt id, the fee id (a payment the relay could not apply), or the request id.
  | 'checkout_settings_invalid'
  // Spec 0011-09 AC-1, R-2: a region's unlock window or fee window floor is missing or malformed, so a verified
  // commission cannot be applied (the relay retries) and a commission of 0 cannot settle. The record is the fee id
  // or the request id.
  | 'unlock_settings_invalid'
  // Spec 0011-10: the contact window setting is missing or malformed.
  | 'contact_settings_invalid'
  // Spec 0011-11: the confirm window setting is missing or malformed.
  | 'confirm_settings_invalid';

export type AlertCause = 'error' | 'missing' | 'not_boolean' | 'timeout';

export type AlertDetail = {
  /** The record the alert is about, such as `TR:notifications_enabled`. An internal id, never personal data. */
  recordId: string;
  region?: Region;
  cause?: AlertCause;
};

export function raiseAlert(reason: AlertReason, detail: AlertDetail): void {
  try {
    if (getClient() === undefined) {
      console.error(JSON.stringify({ alert: reason, ...detail }));
      return;
    }
    withScope((scope) => {
      scope.setTag('alert', reason);
      if (detail.region !== undefined) scope.setTag('region', detail.region);
      if (detail.cause !== undefined) scope.setTag('cause', detail.cause);
      scope.setFingerprint(['alert', reason, detail.recordId, appEnv(process.env)]);
      captureMessage(`alert ${reason}`, 'error');
    });
    flushSoon();
  } catch {
    // An alert that cannot be raised must never break the request that raised it.
  }
}
