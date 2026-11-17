import 'server-only';

import { checkoutStatus, loadCommissionFee, loadOffers, type CheckoutStatus } from './index';

/**
 * What the pay and return pages need about one attempt (spec 0011-09 AC-11, AC-12, R-13): the payer's own
 * status, whether Try again can still pay (the request SELECTED, before its payment deadline), and the receipt
 * link once the commission is paid. Null for an id that does not exist and for another payer's id alike, so
 * both pages answer the same 404.
 */
export async function loadCheckoutPage(
  attemptId: string,
): Promise<{ status: CheckoutStatus; canRetry: boolean; receiptHref: string | null } | null> {
  const status = await checkoutStatus(attemptId);
  if (!status) return null;
  const [offers, fee] = await Promise.all([
    loadOffers(status.request_id),
    status.fee_kind === 'commission' ? loadCommissionFee(status.request_id) : Promise.resolve(null),
  ]);
  const canRetry =
    offers !== null &&
    offers.status === 'SELECTED' &&
    offers.payment_deadline !== null &&
    Date.parse(offers.payment_deadline) > Date.now();
  const receiptHref = fee && fee.status !== 'pending' ? `/receipts/${fee.id}` : null;
  return { status, canRetry, receiptHref };
}
