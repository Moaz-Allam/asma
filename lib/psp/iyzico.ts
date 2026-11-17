import 'server-only';

import { iyzicoCheckoutHosts } from '@/lib/payments/checkout-hosts';

import { PspError, type PspAdapter } from './types';

/**
 * The iyzico slot (spec 0011-08 AC-4, B3). Standard iyzico checkout (D93) over `fetch`, no SDK, built in 08b
 * once the sandbox facts (owner step S1) are in. Until then every call refuses with `psp_not_configured`, and
 * its card page host list is empty, so no iyzico URL is ever stored (AC-21).
 *
 * What S1 must settle before 08b fills this file:
 *   (a) whether the existing account allows standard checkout (D93);
 *   (b) the placeholder identity number, and iyzico's written acceptance of it;
 *   (c) whether a registration and billing address line is required, and what non street value is accepted;
 *   (d) the card page host per environment (`paymentPageUrl`), for iyzicoCheckoutHosts;
 *   (e) the retrieve fields that mean paid (`status`, `paymentStatus`, `fraudStatus`), iyzico's cut, the payment
 *       id and the item transaction id;
 *   (f) the webhook signature scheme, its header, which secret signs it, and the event id;
 *   (g) cancel versus refund, by payment or by item transaction id, how to read a payment's existing refunds,
 *       and the refund id returned;
 *   (h) the callback form fields;
 *   (i) the decimal text format accepted;
 *   (j) the card page locales;
 *   (k) the token lifetime and the retrieve answer for an expired token (R-2): the 2 hour final window and
 *       `checkout_hold_minutes` must both be at least that lifetime;
 *   (l) whether iyzico accepts a placeholder instead of the payer's IP (R-8).
 *
 * 08b, after S1: price and paid price equal to the fee amount, the currency, `conversationId` = attempt id,
 * `basketId` = fee id, one basket item named after the fee kind, installments `[1]` only, locale `tr` for `tr`
 * and `en` for `ar` and `en`, callback URL `appOrigin()` + `/api/psp/callback`, buyer: full name, the payer's
 * profile id, city from `psp_buyer_city`, country Turkey, the payer's email or `EMAIL_FROM`'s address, the
 * placeholder identity number, the request IP. No street line, no phone, no real identity number. Figures back
 * through `parseMinor`; one that does not parse is `psp_bad_response`. The contract suite then runs on recorded
 * S1 responses (tests/psp-contract.test.ts).
 */
export function createIyzicoAdapter(): PspAdapter {
  const refuse = async (): Promise<never> => {
    throw new PspError('psp_not_configured');
  };
  return {
    name: 'iyzico',
    homeRegion: 'TR',
    checkoutHosts: iyzicoCheckoutHosts,
    initializeCheckout: refuse,
    retrieveCheckout: refuse,
    retrievePayment: refuse,
    refundPayment: refuse,
    verifyWebhook: refuse,
  };
}
