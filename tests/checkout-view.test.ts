import { describe, expect, it } from 'vitest';

import { viewOf } from '@/lib/payments/checkout-view';

/**
 * Spec 0011-09 AC-11, AC-12, R-3, R-11: what the pay and return pages show. Only a verified paid fee is success;
 * a late payment says it is refunded even when its attempt stayed succeeded or failed for another reason.
 */

const base = {
  fee_status: 'pending' as const,
  status: 'ready' as const,
  reason: null,
  late_refund: false,
};

describe('viewOf', () => {
  it('waits while the attempt is open and the time is not up', () => {
    expect(viewOf('open', base, false)).toBe('waiting');
    expect(viewOf('return', { ...base, status: 'queued' }, false)).toBe('waiting');
  });

  it('shows success only when the fee is paid', () => {
    expect(viewOf('return', { ...base, fee_status: 'paid', status: 'succeeded' }, false)).toBe('success');
    expect(viewOf('return', { ...base, status: 'succeeded' }, false)).toBe('waiting');
    expect(viewOf('open', { ...base, fee_status: 'paid', status: 'failed', reason: 'failed' }, false)).toBe(
      'success',
    );
  });

  it('shows the late refund from the reason or from the refund row (R-3)', () => {
    expect(viewOf('return', { ...base, status: 'failed', reason: 'late' }, false)).toBe('late');
    expect(viewOf('return', { ...base, status: 'failed', reason: 'failed', late_refund: true }, false)).toBe(
      'late',
    );
    expect(viewOf('return', { ...base, fee_status: 'paid', late_refund: true }, false)).toBe('success');
  });

  it('a refunded fee is final, and a succeeded attempt never offers Try again (review F6)', () => {
    expect(viewOf('return', { ...base, fee_status: 'refunded', status: 'succeeded' }, false)).toBe(
      'refunded',
    );
    expect(viewOf('open', { ...base, fee_status: 'refunded', status: 'succeeded' }, true)).toBe('refunded');
    expect(viewOf('open', { ...base, status: 'succeeded' }, false)).toBe('waiting');
    expect(viewOf('open', { ...base, status: 'succeeded' }, true)).toBe('pendingLong');
    expect(viewOf('return', { ...base, status: 'succeeded' }, true)).toBe('pendingLong');
  });

  it('paused, failed and abandoned stop the wait', () => {
    expect(viewOf('open', { ...base, status: 'failed', reason: 'paused' }, false)).toBe('paused');
    expect(viewOf('open', { ...base, status: 'failed', reason: 'failed' }, false)).toBe('openFailed');
    expect(viewOf('return', { ...base, status: 'abandoned' }, false)).toBe('failed');
  });

  it('after the wait: slow while still queued (R-11), else failed on the pay page, Refresh on the return page', () => {
    expect(viewOf('open', { ...base, status: 'queued' }, true)).toBe('slow');
    expect(viewOf('open', base, true)).toBe('openFailed');
    expect(viewOf('return', base, true)).toBe('pendingLong');
  });
});
