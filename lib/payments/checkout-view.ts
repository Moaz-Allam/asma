/**
 * What the pay and return pages show for one attempt (spec 0011-09 AC-11, AC-12, R-3, R-11). Pure, so the
 * rules are unit tested apart from the polling. Only the relay's verified result moves a page to paid.
 */

export type CheckoutMode = 'open' | 'return';

export type CheckoutView =
  'waiting' | 'slow' | 'openFailed' | 'paused' | 'success' | 'late' | 'refunded' | 'failed' | 'pendingLong';

type Attempt = {
  fee_status: 'pending' | 'paid' | 'refunded';
  status: 'queued' | 'ready' | 'succeeded' | 'failed' | 'abandoned';
  reason: 'late' | 'paused' | 'failed' | null;
  late_refund: boolean;
};

/** The views after which no poll can change the page. */
export const FINAL_VIEWS: readonly CheckoutView[] = [
  'success',
  'late',
  'refunded',
  'failed',
  'openFailed',
  'paused',
];

export function viewOf(mode: CheckoutMode, attempt: Attempt, timedOut: boolean): CheckoutView {
  if (attempt.fee_status === 'paid') return 'success';
  // R-3: a payment refunded as late shows so, whether the relay could close its attempt or not.
  if (attempt.fee_status === 'pending' && (attempt.reason === 'late' || attempt.late_refund)) return 'late';
  // A fee refunded after it was paid (a cancel, an admin refund) is final; it never waits (review F6).
  if (attempt.fee_status === 'refunded') return 'refunded';
  if (attempt.reason === 'paused') return 'paused';
  if (attempt.status === 'failed' || attempt.status === 'abandoned') {
    return mode === 'open' ? 'openFailed' : 'failed';
  }
  // Paid at the card page, the verify not applied yet: never Try again, which would open a second payment
  // (review F6); after the wait the page offers Refresh.
  if (attempt.status === 'succeeded') return timedOut ? 'pendingLong' : 'waiting';
  if (!timedOut) return 'waiting';
  if (mode === 'return') return 'pendingLong';
  // R-11: still queued after the wait means the relay has not opened the card page yet.
  return attempt.status === 'queued' ? 'slow' : 'openFailed';
}
