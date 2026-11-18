import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-09, the customer's door to paying the commission (`lib/requests`) and its actions. The rules are
 * proven in pgTAP (21, 22); here the database answers are stubs, so each branch can be driven on purpose: the
 * argument names (no figure ever sent, rule 1), the locale and the IP read on the server, the strict parses
 * that refuse a key the functions must never send (AC-7, AC-13), the card page URL held to the driver's hosts
 * (AC-9), the alerts on a missing setting only (AC-1, R-6), and the customer role (AC-9).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  alert: vi.fn(),
  warn: vi.fn(),
  report: vi.fn(),
  requireRole: vi.fn(),
  revalidate: vi.fn(),
  locale: vi.fn(async () => 'en'),
  header: vi.fn((): string | null => '203.0.113.7'),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc, from: m.from })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('@/lib/payments/checkout-hosts', () => ({ activeCheckoutHosts: () => ['localhost:3100'] }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: m.header }) }));
vi.mock('next-intl/server', () => ({ getLocale: m.locale }));
vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));

import { checkoutStatusAction, payCommissionAction } from '@/actions/payments';
import { cancelRequestAction } from '@/actions/requests';
import { checkoutStatus, loadCommissionFee, loadReceipt, payCommission } from '@/lib/requests';

const USER = '00000000-0000-4000-8000-0000000000c1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const ATTEMPT = '00000000-0000-4000-8000-0000000000a1';
const FEE = '00000000-0000-4000-8000-0000000000f1';
const STATUS = {
  attempt_id: ATTEMPT,
  request_id: REQUEST,
  fee_kind: 'commission',
  fee_status: 'pending',
  status: 'ready',
  reason: null,
  url: 'http://localhost:3100/en/dev/fake-checkout/fk1_x',
  locale: 'en',
  late_refund: false,
  // Spec 0011-10 R-1.
  fee_id: FEE,
  amount: 10000,
  deadline: '2026-11-20T10:00:00+00:00',
  application_id: null,
};
const RECEIPT = {
  receipt_number: FEE,
  kind: 'commission',
  amount: 10000,
  currency: 'TRY',
  status: 'paid',
  paid_at: '2026-11-17T09:00:00.123456+00:00',
  timezone: 'Europe/Istanbul',
  request_id: REQUEST,
  service_name: { tr: 'Temizlik', en: 'Cleaning' },
  scheduled_start_at: '2026-11-20T07:00:00+00:00',
};
const refuse = (message: string, hint: string | null = null) => ({
  data: null,
  error: { message, code: 'P0001', hint },
});
const CTX = { region: 'TR' as const, userId: USER };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ id: USER, role: 'customer', region: 'TR' });
  m.locale.mockResolvedValue('en');
  m.header.mockReturnValue('203.0.113.7');
});

describe('payCommission (AC-4, AC-9)', () => {
  it('sends the request id, the locale and the IP, never a figure', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'checkout', attempt_id: ATTEMPT, reused: false },
      error: null,
    });
    expect(await payCommission({ requestId: REQUEST, locale: 'ar', payerIp: '203.0.113.7' }, CTX)).toEqual({
      ok: true,
      status: 'checkout',
      attemptId: ATTEMPT,
      reused: false,
    });
    expect(m.rpc).toHaveBeenCalledWith('pay_commission', {
      p_request_id: REQUEST,
      p_locale: 'ar',
      p_payer_ip: '203.0.113.7',
    });
  });

  it('a commission of 0 comes back settled (D171)', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'settled' }, error: null });
    expect(await payCommission({ requestId: REQUEST, locale: 'tr', payerIp: null }, CTX)).toEqual({
      ok: true,
      status: 'settled',
    });
  });

  it('refuses a result carrying a key the function must never send', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'checkout', attempt_id: ATTEMPT, reused: false, amount: 10000 },
      error: null,
    });
    await expect(payCommission({ requestId: REQUEST, locale: 'tr', payerIp: null }, CTX)).rejects.toThrow();
  });

  it.each(['checkout_settings_invalid', 'unlock_settings_invalid'])('alerts on %s', async (code) => {
    m.rpc.mockResolvedValue(refuse(code));
    expect(await payCommission({ requestId: REQUEST, locale: 'tr', payerIp: null }, CTX)).toEqual({
      ok: false,
      code,
    });
    expect(m.alert).toHaveBeenCalledWith(code, { recordId: REQUEST, region: 'TR' });
  });

  it.each([
    'not_found',
    'invalid_state',
    'already_paid',
    'deadline_passed',
    'payments_disabled',
    'too_many_checkouts',
  ])('maps %s to its code with no alert', async (code) => {
    m.rpc.mockResolvedValue(refuse(code));
    expect(await payCommission({ requestId: REQUEST, locale: 'tr', payerIp: null }, CTX)).toEqual({
      ok: false,
      code,
    });
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('throws a raw database error for the action to report', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } });
    await expect(
      payCommission({ requestId: REQUEST, locale: 'tr', payerIp: null }, CTX),
    ).rejects.toBeTruthy();
  });
});

describe('payCommissionAction (AC-9, AC-14)', () => {
  it('reads the locale from the route and the IP from x-real-ip, for the customer role only', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'checkout', attempt_id: ATTEMPT, reused: true }, error: null });
    expect(await payCommissionAction({ requestId: REQUEST })).toEqual({
      success: true,
      data: { status: 'checkout', attemptId: ATTEMPT, reused: true },
    });
    expect(m.rpc).toHaveBeenCalledWith('pay_commission', {
      p_request_id: REQUEST,
      p_locale: 'en',
      p_payer_ip: '203.0.113.7',
    });
    expect(m.requireRole).toHaveBeenCalledWith('customer');
  });

  it('sends a null IP when the header is missing or too long, and tr for a locale it does not know', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'settled' }, error: null });
    m.header.mockReturnValueOnce(null);
    m.locale.mockResolvedValueOnce('de');
    await payCommissionAction({ requestId: REQUEST });
    expect(m.rpc).toHaveBeenLastCalledWith('pay_commission', {
      p_request_id: REQUEST,
      p_locale: 'tr',
      p_payer_ip: null,
    });
    m.header.mockReturnValueOnce('1'.repeat(46));
    await payCommissionAction({ requestId: REQUEST });
    expect(m.rpc).toHaveBeenLastCalledWith('pay_commission', expect.objectContaining({ p_payer_ip: null }));
  });

  it('revalidates after a settle, not after a checkout', async () => {
    m.rpc.mockResolvedValueOnce({
      data: { status: 'checkout', attempt_id: ATTEMPT, reused: false },
      error: null,
    });
    await payCommissionAction({ requestId: REQUEST });
    expect(m.revalidate).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({ data: { status: 'settled' }, error: null });
    expect(await payCommissionAction({ requestId: REQUEST })).toEqual({
      success: true,
      data: { status: 'settled' },
    });
    expect(m.revalidate).toHaveBeenCalledWith('/', 'layout');
  });

  it('maps a refusal to its code with no Sentry report', async () => {
    m.rpc.mockResolvedValue(refuse('payments_disabled'));
    expect(await payCommissionAction({ requestId: REQUEST })).toEqual({
      success: false,
      error: 'payments_disabled',
    });
    expect(m.report).not.toHaveBeenCalled();
  });

  it('refuses a figure or any other key before any database call', async () => {
    expect(await payCommissionAction({ requestId: REQUEST, amount: 1 })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(await payCommissionAction({ requestId: 'r-1' })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('checkoutStatus (AC-7, AC-9, R-13)', () => {
  it('returns the payer fields and a URL on the driver hosts', async () => {
    m.rpc.mockResolvedValue({ data: STATUS, error: null });
    expect(await checkoutStatus(ATTEMPT)).toEqual(STATUS);
    expect(m.rpc).toHaveBeenCalledWith('my_checkout', { p_attempt_id: ATTEMPT });
  });

  it('drops a URL off the hosts and logs the attempt id only', async () => {
    m.rpc.mockResolvedValue({ data: { ...STATUS, url: 'https://evil.example/p' }, error: null });
    expect((await checkoutStatus(ATTEMPT))?.url).toBeNull();
    expect(m.warn).toHaveBeenCalledWith('checkout_url_refused', { request_id: ATTEMPT });
  });

  it('answers null for not_found and for a malformed id, with no call for the latter', async () => {
    expect(await checkoutStatus('nope')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await checkoutStatus(ATTEMPT)).toBeNull();
  });

  it('refuses a token, an IP or a PSP payment id in the answer', async () => {
    for (const extra of [{ psp_token: 't' }, { payer_ip: '1.2.3.4' }, { psp_payment_id: 'p' }]) {
      m.rpc.mockResolvedValue({ data: { ...STATUS, ...extra }, error: null });
      await expect(checkoutStatus(ATTEMPT)).rejects.toThrow();
    }
  });

  it('the action answers not_found for another payer and asks for either payer role (spec 0011-10 R-7)', async () => {
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await checkoutStatusAction({ attemptId: ATTEMPT })).toEqual({
      success: false,
      error: 'not_found',
    });
    expect(m.requireRole).toHaveBeenCalledWith('customer', 'provider');
  });
});

describe('loadReceipt and loadCommissionFee (AC-10, AC-13)', () => {
  it('parses the receipt and refuses a PSP payment id', async () => {
    m.rpc.mockResolvedValue({ data: RECEIPT, error: null });
    expect(await loadReceipt(FEE)).toEqual(RECEIPT);
    expect(m.rpc).toHaveBeenCalledWith('my_receipt', { p_receipt_id: FEE });
    m.rpc.mockResolvedValue({ data: { ...RECEIPT, psp_payment_id: 'p' }, error: null });
    await expect(loadReceipt(FEE)).rejects.toThrow();
  });

  it('answers null for not_found and for a malformed id', async () => {
    expect(await loadReceipt('nope')).toBeNull();
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await loadReceipt(FEE)).toBeNull();
  });

  it('reads the commission row through RLS', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: FEE, status: 'paid', paid_at: RECEIPT.paid_at },
      error: null,
    }));
    const eq2 = vi.fn(() => ({ maybeSingle }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    m.from.mockReturnValue({ select });
    expect(await loadCommissionFee(REQUEST)).toEqual({ id: FEE, status: 'paid', paid_at: RECEIPT.paid_at });
    expect(m.from).toHaveBeenCalledWith('fee_payments');
    expect(select).toHaveBeenCalledWith('id, status, paid_at');
    expect(eq1).toHaveBeenCalledWith('request_id', REQUEST);
    expect(eq2).toHaveBeenCalledWith('kind', 'commission');
  });
});

describe('cancel during a checkout (AC-2, R-6)', () => {
  it('maps checkout_open, and alerts only when the hold setting was missing', async () => {
    m.rpc.mockResolvedValue(refuse('checkout_open'));
    expect(await cancelRequestAction({ requestId: REQUEST, reason: null })).toEqual({
      success: false,
      error: 'checkout_open',
    });
    expect(m.alert).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue(refuse('checkout_open', 'checkout_settings_invalid'));
    await cancelRequestAction({ requestId: REQUEST, reason: null });
    expect(m.alert).toHaveBeenCalledWith('checkout_settings_invalid', { recordId: REQUEST, region: 'TR' });
  });
});
