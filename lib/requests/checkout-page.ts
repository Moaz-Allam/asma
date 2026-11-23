import 'server-only';

import { myAcceptedAgreement } from '@/lib/agreements';

import { checkoutStatus, loadOffers, type CheckoutStatus } from './index';

/**
 * What the pay and return pages need about one attempt (spec 0011-09 AC-11, AC-12, R-13; spec 0011-10 AC-9,
 * R-1): the payer's own status, whether Try again can still pay, and the receipt link once the fee is paid.
 * Null for an id that does not exist and for another payer's id alike, so the pages answer the same 404.
 *
 * A commission can be paid again while the request is `SELECTED` before its payment deadline (the customer
 * reads the request). A provider has no read on requests, so a provider fee reads only what `my_checkout`
 * returns: the fee still pending before its own deadline (`fee_deadline`).
 */
export async function loadCheckoutPage(attemptId: string): Promise<{
  status: CheckoutStatus;
  canRetry: boolean;
  receiptHref: string | null;
  agreementVersion: string | null;
} | null> {
  const status = await checkoutStatus(attemptId);
  if (!status) return null;
  let canRetry: boolean;
  if (status.fee_kind === 'commission') {
    const offers = await loadOffers(status.request_id);
    canRetry =
      offers !== null &&
      offers.status === 'SELECTED' &&
      offers.payment_deadline !== null &&
      Date.parse(offers.payment_deadline) > Date.now();
  } else {
    canRetry =
      status.fee_status === 'pending' && status.deadline !== null && Date.parse(status.deadline) > Date.now();
  }
  const receiptHref = status.fee_status !== 'pending' ? `/receipts/${status.fee_id}` : null;
  // Spec 0011-20 AC-2, AC-3: Try again sends the version this payer already accepted; without one it cannot pay.
  const agreementVersion = canRetry ? await myAcceptedAgreement(status.request_id) : null;
  return { status, canRetry: canRetry && agreementVersion !== null, receiptHref, agreementVersion };
}
