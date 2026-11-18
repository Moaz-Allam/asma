import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-10, the provider fee and the reveal: the provider's door (`lib/provider-feed`: `payProviderFee`,
 * `listJobs`), the contacts read (`lib/requests`: `loadContacts`) and the actions. The rules are proven in pgTAP
 * (23, 24); here the database answers are stubs, so each branch can be driven on purpose: the argument names (no
 * figure ever sent, rule 1), the strict parses that refuse a contact field where none may be (R-11) and an
 * address field on the customer's side (AC-5), the alerts on a missing setting, and each action's own role (R-13).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  alert: vi.fn(),
  report: vi.fn(),
  role: { current: 'provider' as 'provider' | 'customer' },
  revalidate: vi.fn(),
  locale: vi.fn(async () => 'tr'),
  header: vi.fn((): string | null => '203.0.113.7'),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('@/lib/payments/checkout-hosts', () => ({ activeCheckoutHosts: () => ['localhost:3100'] }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: m.header }) }));
vi.mock('next-intl/server', () => ({ getLocale: m.locale }));
vi.mock('@/lib/auth/session', async (original) => {
  const actual = await original<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    // The real rule: a role outside the action's list is refused `forbidden`.
    requireRole: vi.fn(async (...roles: string[]) => {
      if (roles.length > 0 && !roles.includes(m.role.current)) throw new actual.AuthRefusal('forbidden');
      return { id: USER, role: m.role.current, region: 'TR' };
    }),
  };
});

import { payCommissionAction, payProviderFeeAction } from '@/actions/payments';
import { listJobs, payProviderFee } from '@/lib/provider-feed';
import { loadContacts } from '@/lib/requests';

const USER = '00000000-0000-4000-8000-0000000000b1';
const APP = '00000000-0000-4000-8000-0000000000e1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const ATTEMPT = '00000000-0000-4000-8000-0000000000a1';
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001', hint: null } });
const CTX = { region: 'TR' as const };

const JOB = {
  id: REQUEST,
  service_id: REQUEST,
  zone_id: REQUEST,
  service_name: { tr: 'Temizlik' },
  zone_name: { tr: 'Moda' },
  addon_names: [],
  scheduled_start_at: '2026-11-20T07:00:00+00:00',
  scheduled_end_at: '2026-11-20T09:00:00+00:00',
  fixed_price: 100000,
  cash_due: 90000,
  currency: 'TRY',
  application_id: APP,
  application_status: 'AWAITING_FEE',
  status_changed_at: '2026-11-17T09:00:00+00:00',
  provider_fee_amount: 5000,
  unlocked_at: null,
  payment_deadline: null,
  fee_deadline: '2026-11-18T09:00:00+00:00',
};
const PROVIDER_SIDE = {
  side: 'provider',
  name: 'Ece Müşteri',
  phone: '+905559230001',
  whatsapp: 'https://wa.me/905559230001',
  email: null,
  email_confirmed: false,
  street: 'Moda Cad. No 5',
  notes: 'Ring twice',
  zone: { tr: 'Moda' },
  scheduled_start_at: '2026-11-20T07:00:00+00:00',
  scheduled_end_at: '2026-11-20T09:00:00+00:00',
  timezone: 'Europe/Istanbul',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.role.current = 'provider';
  m.locale.mockResolvedValue('tr');
  m.header.mockReturnValue('203.0.113.7');
});

describe('payProviderFee (AC-2, AC-8)', () => {
  it('sends the application id, the locale and the IP, never a figure', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'checkout', attempt_id: ATTEMPT, reused: false },
      error: null,
    });
    expect(await payProviderFee({ applicationId: APP, locale: 'tr', payerIp: null }, CTX)).toEqual({
      ok: true,
      status: 'checkout',
      attemptId: ATTEMPT,
      reused: false,
    });
    expect(m.rpc).toHaveBeenCalledWith('pay_provider_fee', {
      p_application_id: APP,
      p_locale: 'tr',
      p_payer_ip: null,
    });
  });

  it('settles a fee of 0', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'settled' }, error: null });
    expect(await payProviderFee({ applicationId: APP, locale: 'tr', payerIp: null }, CTX)).toEqual({
      ok: true,
      status: 'settled',
    });
  });

  it.each(['invalid_state', 'already_paid', 'deadline_passed', 'payments_disabled', 'too_many_checkouts'])(
    'maps %s to its code with no alert',
    async (code) => {
      m.rpc.mockResolvedValue(refuse(code));
      expect(await payProviderFee({ applicationId: APP, locale: 'tr', payerIp: null }, CTX)).toEqual({
        ok: false,
        code,
      });
      expect(m.alert).not.toHaveBeenCalled();
    },
  );

  it.each(['checkout_settings_invalid', 'unlock_settings_invalid'])('alerts on %s', async (code) => {
    m.rpc.mockResolvedValue(refuse(code));
    await payProviderFee({ applicationId: APP, locale: 'tr', payerIp: null }, CTX);
    expect(m.alert).toHaveBeenCalledWith(code, { recordId: 'pay_provider_fee', region: 'TR' });
  });

  it('refuses a key the function must never send', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'settled', amount: 5000 }, error: null });
    await expect(payProviderFee({ applicationId: APP, locale: 'tr', payerIp: null }, CTX)).rejects.toThrow();
  });
});

describe('the actions (AC-8, R-13)', () => {
  it('the provider pays with the page locale and the IP Vercel saw', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'checkout', attempt_id: ATTEMPT, reused: true }, error: null });
    expect(await payProviderFeeAction({ applicationId: APP })).toEqual({
      success: true,
      data: { status: 'checkout', attemptId: ATTEMPT, reused: true },
    });
    expect(m.rpc).toHaveBeenCalledWith('pay_provider_fee', {
      p_application_id: APP,
      p_locale: 'tr',
      p_payer_ip: '203.0.113.7',
    });
  });

  it('a customer on the provider fee action is forbidden', async () => {
    m.role.current = 'customer';
    expect(await payProviderFeeAction({ applicationId: APP })).toEqual({
      success: false,
      error: 'forbidden',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('a provider on the commission action is forbidden', async () => {
    expect(await payCommissionAction({ requestId: REQUEST })).toEqual({ success: false, error: 'forbidden' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('a malformed application id is refused before the database', async () => {
    expect(await payProviderFeeAction({ applicationId: 'nope' })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe('listJobs (R-11)', () => {
  it('reads one tab with its cursor and returns the next one', async () => {
    m.rpc.mockResolvedValue({
      data: { timezone: 'Europe/Istanbul', now: '2026-11-17T10:00:00+00:00', has_more: true, rows: [JOB] },
      error: null,
    });
    const result = await listJobs('chosen', null, CTX);
    expect(m.rpc).toHaveBeenCalledWith('provider_jobs', {
      p_tab: 'chosen',
      p_after_changed_at: null,
      p_after_id: null,
    });
    expect(result.ok && result.next).toBeTruthy();
  });

  it('refuses a job row that carries a contact field', async () => {
    m.rpc.mockResolvedValue({
      data: {
        timezone: 'Europe/Istanbul',
        now: '2026-11-17T10:00:00+00:00',
        has_more: false,
        rows: [{ ...JOB, phone: '+905559230001' }],
      },
      error: null,
    });
    await expect(listJobs('active', null, CTX)).rejects.toThrow();
  });
});

describe('loadContacts (AC-5)', () => {
  it('returns what Postgres returns for the provider side', async () => {
    m.rpc.mockResolvedValue({ data: PROVIDER_SIDE, error: null });
    expect(await loadContacts(REQUEST, { region: 'TR', userId: USER })).toEqual(PROVIDER_SIDE);
    expect(m.rpc).toHaveBeenCalledWith('request_contacts', { p_request_id: REQUEST });
  });

  it('null before the reveal, past the window or for anyone else', async () => {
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await loadContacts(REQUEST, { region: 'TR', userId: USER })).toBeNull();
    expect(await loadContacts('nope', { region: 'TR', userId: USER })).toBeNull();
  });

  it('a missing window setting alerts and reads as hidden', async () => {
    m.rpc.mockResolvedValue(refuse('contact_settings_invalid'));
    expect(await loadContacts(REQUEST, { region: 'TR', userId: USER })).toBeNull();
    expect(m.alert).toHaveBeenCalledWith('contact_settings_invalid', { recordId: REQUEST, region: 'TR' });
  });

  it('refuses an address field on the customer side', async () => {
    const { street, notes, zone, scheduled_start_at, scheduled_end_at, timezone, ...base } = PROVIDER_SIDE;
    void [notes, zone, scheduled_start_at, scheduled_end_at, timezone];
    m.rpc.mockResolvedValue({ data: { ...base, side: 'customer', street }, error: null });
    await expect(loadContacts(REQUEST, { region: 'TR', userId: USER })).rejects.toThrow();
  });

  it('refuses a WhatsApp link that is not wa.me', async () => {
    m.rpc.mockResolvedValue({ data: { ...PROVIDER_SIDE, whatsapp: 'https://evil.example/x' }, error: null });
    await expect(loadContacts(REQUEST, { region: 'TR', userId: USER })).rejects.toThrow();
  });
});
