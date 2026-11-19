import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-12, expiry, cancellation and fee refunds: the doors and the actions. The rules are proven in pgTAP (27,
 * 28); here the database answers are stubs: the argument names (ids and free text only, never an amount), the strict
 * parses, the refusal codes, and each action's own role (AC-13, AC-14).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  alert: vi.fn(),
  report: vi.fn(),
  revalidate: vi.fn(),
  role: { current: 'provider' as 'provider' | 'customer' | 'admin' },
}));

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })) }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => {
  const actual = await original<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    requireRole: vi.fn(async (...roles: string[]) => {
      if (roles.length > 0 && !roles.includes(m.role.current)) throw new actual.AuthRefusal('forbidden');
      return { id: '00000000-0000-4000-8000-0000000000b1', role: m.role.current, region: 'TR' };
    }),
  };
});

import { adminMarkRefundDoneAction, adminRefundFeeAction } from '@/actions/admin-requests';
import { providerCancelJobAction, withdrawApplicationAction } from '@/actions/jobs';
import { cancelRequestAction, chooseProviderAction } from '@/actions/requests';
import { loadAdminRequest, markRefundDone, refundFee } from '@/lib/admin-requests';
import { reasonLength, requestIdFrom } from '@/lib/admin-requests/constants';
import { jobCancelPreview, providerCancelJob, withdrawApplication } from '@/lib/provider-feed';
import { cancelPreview, cancelRequest, chooseProvider } from '@/lib/requests';

const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const APPLICATION = '00000000-0000-4000-8000-0000000000a1';
const FEE = '00000000-0000-4000-8000-0000000000f1';
const REFUND = '00000000-0000-4000-8000-0000000000e1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const CONTEXT = { region: 'TR' as const, userId: USER };
const AT = '2026-11-18T09:00:00.123456+00:00';
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001', hint: null } });
const ok = (data: unknown) => ({ data, error: null });

const PREVIEW = {
  actor: 'customer',
  state: 'COMMISSION_PAID',
  can_cancel: true,
  checkout_open: false,
  commission_outcome: 'refund',
  provider_fee_outcome: 'not_paid',
  counts_against: 'nobody',
  refund: { kind: 'commission', amount: 10000, currency: 'TRY' },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.role.current = 'provider';
});

describe('the customer door (AC-4, AC-6, AC-14)', () => {
  it('a cancel returns the refund queued, without its id', async () => {
    m.rpc.mockResolvedValue(
      ok({ status: 'ok', refund: { fee_refund_id: REFUND, amount: 10000, currency: 'TRY' } }),
    );
    expect(await cancelRequest(REQUEST, null, CONTEXT)).toEqual({
      ok: true,
      refund: { amount: 10000, currency: 'TRY' },
    });
    expect(m.rpc).toHaveBeenCalledWith('cancel_request', { p_request_id: REQUEST, p_reason: null });
  });

  it('a cancel with nothing to refund returns none; a stray key fails the parse', async () => {
    m.rpc.mockResolvedValue(ok({ status: 'ok' }));
    expect(await cancelRequest(REQUEST, 'other', CONTEXT)).toEqual({ ok: true, refund: null });
    m.rpc.mockResolvedValue(ok({ status: 'ok', psp_payment_id: 'p-1' }));
    await expect(cancelRequest(REQUEST, null, CONTEXT)).rejects.toThrow();
  });

  it('maps not_cancellable after the work is done (row 12)', async () => {
    m.rpc.mockResolvedValue(refuse('not_cancellable'));
    expect(await cancelRequest(REQUEST, null, CONTEXT)).toEqual({ ok: false, code: 'not_cancellable' });
  });

  it('reads the preview, and nothing for a malformed id or anyone else', async () => {
    expect(await cancelPreview('nope')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue(ok(PREVIEW));
    expect(await cancelPreview(REQUEST)).toEqual(PREVIEW);
    expect(m.rpc).toHaveBeenCalledWith('cancel_preview', { p_request_id: REQUEST });
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await cancelPreview(REQUEST)).toBeNull();
    // Review of 12: any other refusal hides the button rather than breaking the page.
    m.rpc.mockResolvedValue(refuse('checkout_settings_invalid'));
    expect(await cancelPreview(REQUEST)).toBeNull();
  });

  it('the preview parse is strict', async () => {
    m.rpc.mockResolvedValue(ok({ ...PREVIEW, provider_id: USER }));
    await expect(cancelPreview(REQUEST)).rejects.toThrow();
    m.rpc.mockResolvedValue(ok({ ...PREVIEW, refund: { ...PREVIEW.refund, fee_id: FEE } }));
    await expect(cancelPreview(REQUEST)).rejects.toThrow();
  });

  it('a carried re-pick has no payment window, only the fee window (AC-4, R-3)', async () => {
    m.rpc.mockResolvedValue(
      ok({
        status: 'ok',
        replayed: false,
        selected_at: AT,
        payment_deadline: null,
        carried: true,
        fee_deadline: AT,
      }),
    );
    expect(await chooseProvider({ requestId: REQUEST, applicationId: APPLICATION }, CONTEXT)).toEqual({
      ok: true,
      replayed: false,
      selectedAt: AT,
      paymentDeadline: null,
      carried: true,
      feeDeadline: AT,
    });
  });

  it('a pick with neither a payment window nor a carry fails the parse', async () => {
    m.rpc.mockResolvedValue(ok({ status: 'ok', replayed: false, selected_at: AT, payment_deadline: null }));
    await expect(
      chooseProvider({ requestId: REQUEST, applicationId: APPLICATION }, CONTEXT),
    ).rejects.toThrow();
    m.rpc.mockResolvedValue(
      ok({
        status: 'ok',
        replayed: false,
        selected_at: AT,
        payment_deadline: AT,
        carried: true,
        fee_deadline: AT,
      }),
    );
    await expect(
      chooseProvider({ requestId: REQUEST, applicationId: APPLICATION }, CONTEXT),
    ).rejects.toThrow();
  });

  it('maps provider_not_eligible with no alert', async () => {
    m.rpc.mockResolvedValue(refuse('provider_not_eligible'));
    expect(await chooseProvider({ requestId: REQUEST, applicationId: APPLICATION }, CONTEXT)).toEqual({
      ok: false,
      code: 'provider_not_eligible',
    });
    expect(m.alert).not.toHaveBeenCalled();
  });
});

describe('the provider door (AC-5, AC-6, AC-14)', () => {
  it('withdraw sends the application id only', async () => {
    m.rpc.mockResolvedValue(ok({ status: 'ok', replayed: false }));
    expect(await withdrawApplication(APPLICATION, { region: 'TR' })).toEqual({ ok: true, replayed: false });
    expect(m.rpc).toHaveBeenCalledWith('withdraw_application', { p_application_id: APPLICATION });
  });

  it.each(['invalid_state', 'checkout_open', 'not_found'])('withdraw maps %s', async (code) => {
    m.rpc.mockResolvedValue(refuse(code));
    expect(await withdrawApplication(APPLICATION, { region: 'TR' })).toEqual({ ok: false, code });
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('a malformed id never reaches the database', async () => {
    expect(await withdrawApplication('nope', { region: 'TR' })).toEqual({ ok: false, code: 'not_found' });
    expect(await providerCancelJob('nope', { region: 'TR' })).toEqual({ ok: false, code: 'not_found' });
    expect(await jobCancelPreview('nope', { region: 'TR' })).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('the provider cancel sends the request id only and maps not_cancellable', async () => {
    m.rpc.mockResolvedValue(ok({ status: 'ok' }));
    expect(await providerCancelJob(REQUEST, { region: 'TR' })).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith('provider_cancel_job', { p_request_id: REQUEST });
    m.rpc.mockResolvedValue(refuse('not_cancellable'));
    expect(await providerCancelJob(REQUEST, { region: 'TR' })).toEqual({
      ok: false,
      code: 'not_cancellable',
    });
  });

  it('reads its preview, null for anyone but the unlocked provider', async () => {
    const preview = {
      ...PREVIEW,
      actor: 'provider',
      state: 'UNLOCKED',
      commission_outcome: 'none',
      provider_fee_outcome: 'none',
      counts_against: 'provider_cancellation',
      refund: null,
    };
    m.rpc.mockResolvedValue(ok(preview));
    expect(await jobCancelPreview(REQUEST, { region: 'TR' })).toEqual(preview);
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await jobCancelPreview(REQUEST, { region: 'TR' })).toBeNull();
    m.rpc.mockResolvedValue(refuse('checkout_settings_invalid'));
    expect(await jobCancelPreview(REQUEST, { region: 'TR' })).toBeNull();
  });
});

const DETAIL = {
  request: {
    id: REQUEST,
    region: 'TR',
    status: 'CANCELLED',
    customer_id: USER,
    service_name: { tr: 'Temizlik' },
    zone_name: { tr: 'Moda' },
    timezone: 'Europe/Istanbul',
    fixed_price: 100000,
    commission_amount: 10000,
    cash_due: 90000,
    currency: 'TRY',
    scheduled_start_at: AT,
    scheduled_end_at: AT,
    created_at: AT,
    selected_application_id: null,
    selected_at: null,
    payment_deadline: null,
    fee_deadline: null,
    failed_picks: 3,
    cancelled_at: AT,
    cancelled_by: 'platform',
    cancel_reason: null,
    closed_at: AT,
    closed_by: 'platform',
    actual_started_at: null,
    actual_completed_at: null,
    confirm_deadline: null,
  },
  applications: [
    {
      id: APPLICATION,
      provider_id: USER,
      provider_name: 'Usta',
      status: 'EXPIRED',
      selected: false,
      created_at: AT,
      status_changed_at: AT,
      unlocked_at: null,
      provider_fee_amount: 5000,
    },
  ],
  fees: [
    {
      id: FEE,
      kind: 'commission',
      provider_id: null,
      application_id: null,
      amount: 10000,
      currency: 'TRY',
      status: 'paid',
      paid_at: AT,
      psp_payment_id: 'pay-1',
      psp_fee_amount: 300,
      created_at: AT,
    },
  ],
  refunds: [
    {
      id: REFUND,
      kind: 'fee',
      fee_payment_id: FEE,
      psp_payment_id: 'pay-1',
      amount: 10000,
      currency: 'TRY',
      reason: 'failed_picks',
      status: 'failed',
      requested_by: null,
      created_at: AT,
      finished_at: null,
    },
  ],
  ledger: [
    {
      journal_id: '00000000-0000-4000-8000-0000000000c1',
      kind: 'fee_paid',
      key: `fee:${FEE}:paid`,
      fee_payment_id: FEE,
      currency: 'TRY',
      created_at: AT,
      entries: [
        { account: 'psp_clearing', amount: 10000 },
        { account: 'commission_revenue', amount: -10000 },
      ],
    },
  ],
  flags: [],
  timeline: [
    {
      id: 7,
      action: 'request.cancelled_by_platform',
      actor_id: null,
      entity_type: 'requests',
      entity_id: REQUEST,
      old_value: { status: 'COMMISSION_PAID' },
      new_value: { status: 'CANCELLED' },
      created_at: AT,
    },
  ],
};

describe('the admin door (AC-8, AC-9, AC-12)', () => {
  it('reads one request; nothing for a malformed or unknown id', async () => {
    expect(await loadAdminRequest('nope')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue(ok(DETAIL));
    expect(await loadAdminRequest(REQUEST)).toEqual(DETAIL);
    expect(m.rpc).toHaveBeenCalledWith('admin_request_detail', { p_request_id: REQUEST });
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await loadAdminRequest(REQUEST)).toBeNull();
  });

  it('a non admin read throws, and the address never parses', async () => {
    m.rpc.mockResolvedValue(refuse('forbidden'));
    await expect(loadAdminRequest(REQUEST)).rejects.toThrow();
    m.rpc.mockResolvedValue(ok({ ...DETAIL, request: { ...DETAIL.request, address_line: 'Moda Cad. 7' } }));
    await expect(loadAdminRequest(REQUEST)).rejects.toThrow();
  });

  it('refund by hand sends the fee id and the reason, never an amount', async () => {
    m.rpc.mockResolvedValue(ok({ status: 'ok', replayed: false, fee_refund_id: REFUND }));
    expect(await refundFee({ paymentId: FEE, reason: 'The customer called support.' })).toEqual({
      ok: true,
      replayed: false,
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_refund_fee', {
      p_payment_id: FEE,
      p_reason: 'The customer called support.',
    });
  });

  it.each(['reason_required', 'invalid_state', 'forbidden', 'not_found'])('maps %s', async (code) => {
    m.rpc.mockResolvedValue(refuse(code));
    expect(await refundFee({ paymentId: FEE, reason: 'short' })).toEqual({ ok: false, code });
    expect(await markRefundDone({ refundId: REFUND, note: 'short' })).toEqual({ ok: false, code });
  });

  it('marks a refused refund done by hand with the refund id and the note', async () => {
    m.rpc.mockResolvedValue(
      ok({ status: 'ok', replayed: false, journal_id: '00000000-0000-4000-8000-0000000000c2' }),
    );
    expect(await markRefundDone({ refundId: REFUND, note: 'Refunded in the iyzico panel.' })).toEqual({
      ok: true,
      replayed: false,
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_mark_refund_done', {
      p_refund_id: REFUND,
      p_note: 'Refunded in the iyzico panel.',
    });
    m.rpc.mockResolvedValue(ok({ status: 'ok', replayed: true }));
    expect(await markRefundDone({ refundId: REFUND, note: 'Refunded in the iyzico panel.' })).toEqual({
      ok: true,
      replayed: true,
    });
  });

  it('counts the reason as Postgres does and reads a request id from the find field', () => {
    expect(reasonLength('  ğüşİöç  ')).toBe(6);
    expect(requestIdFrom(`  ${REQUEST.toUpperCase()} `)).toBe(REQUEST);
    expect(requestIdFrom('12345')).toBeNull();
  });
});

describe('the actions take their own role (AC-5, AC-6, AC-8, AC-9)', () => {
  it('the provider withdraws and cancels; the customer is forbidden there', async () => {
    m.rpc.mockResolvedValue(ok({ status: 'ok', replayed: false }));
    expect(await withdrawApplicationAction({ applicationId: APPLICATION })).toEqual({
      success: true,
      data: { replayed: false },
    });
    m.rpc.mockResolvedValue(ok({ status: 'ok' }));
    expect(await providerCancelJobAction({ requestId: REQUEST })).toEqual({
      success: true,
      data: { status: 'ok' },
    });
    expect(m.revalidate).toHaveBeenCalledWith('/', 'layout');
    m.role.current = 'customer';
    expect(await withdrawApplicationAction({ applicationId: APPLICATION })).toEqual({
      success: false,
      error: 'forbidden',
    });
    expect(await providerCancelJobAction({ requestId: REQUEST })).toEqual({
      success: false,
      error: 'forbidden',
    });
  });

  it('a withdraw refusal comes back as its code; an extra key never reaches the database', async () => {
    m.rpc.mockResolvedValue(refuse('checkout_open'));
    expect(await withdrawApplicationAction({ applicationId: APPLICATION })).toEqual({
      success: false,
      error: 'checkout_open',
    });
    m.rpc.mockClear();
    expect(await withdrawApplicationAction({ applicationId: APPLICATION, requestId: REQUEST })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('the customer cancel returns the refund; a provider is forbidden there', async () => {
    m.role.current = 'customer';
    m.rpc.mockResolvedValue(
      ok({ status: 'ok', refund: { fee_refund_id: REFUND, amount: 10000, currency: 'TRY' } }),
    );
    expect(await cancelRequestAction({ requestId: REQUEST, reason: 'plans_changed' })).toEqual({
      success: true,
      data: { status: 'ok', refund: { amount: 10000, currency: 'TRY' } },
    });
    m.role.current = 'provider';
    expect(await cancelRequestAction({ requestId: REQUEST, reason: null })).toEqual({
      success: false,
      error: 'forbidden',
    });
  });

  it('the customer chooses with a carried commission', async () => {
    m.role.current = 'customer';
    m.rpc.mockResolvedValue(
      ok({
        status: 'ok',
        replayed: false,
        selected_at: AT,
        payment_deadline: null,
        carried: true,
        fee_deadline: AT,
      }),
    );
    expect(await chooseProviderAction({ requestId: REQUEST, applicationId: APPLICATION })).toEqual({
      success: true,
      data: { replayed: false, selectedAt: AT, paymentDeadline: null, carried: true, feeDeadline: AT },
    });
  });

  it('admin refunds and marks done; a customer and a provider are forbidden', async () => {
    m.role.current = 'admin';
    m.rpc.mockResolvedValue(ok({ status: 'ok', replayed: false, fee_refund_id: REFUND }));
    expect(await adminRefundFeeAction({ paymentId: FEE, reason: 'The customer called support.' })).toEqual({
      success: true,
      data: { replayed: false },
    });
    m.rpc.mockResolvedValue(ok({ status: 'ok', replayed: true }));
    expect(
      await adminMarkRefundDoneAction({ refundId: REFUND, note: 'Refunded in the iyzico panel.' }),
    ).toEqual({ success: true, data: { replayed: true } });
    for (const role of ['customer', 'provider'] as const) {
      m.role.current = role;
      expect(await adminRefundFeeAction({ paymentId: FEE, reason: 'The customer called support.' })).toEqual({
        success: false,
        error: 'forbidden',
      });
      expect(
        await adminMarkRefundDoneAction({ refundId: REFUND, note: 'Refunded in the iyzico panel.' }),
      ).toEqual({ success: false, error: 'forbidden' });
    }
  });

  it('admin never sends an amount, and a short reason is the database refusal', async () => {
    m.role.current = 'admin';
    expect(
      await adminRefundFeeAction({ paymentId: FEE, reason: 'The customer called support.', amount: 1 }),
    ).toEqual({ success: false, error: 'validation_failed' });
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue(refuse('reason_required'));
    expect(await adminRefundFeeAction({ paymentId: FEE, reason: 'short' })).toEqual({
      success: false,
      error: 'reason_required',
    });
    expect(m.report).not.toHaveBeenCalled();
  });
});
