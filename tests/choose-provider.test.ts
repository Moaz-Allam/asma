import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0010, the customer's door to offers and the choose (`lib/requests`) and its action. The rules are
 * proven in pgTAP (16, 17); here the database answers are stubs, so each branch can be driven on purpose: the
 * strict parse that refuses a key the function must never send (AC-2), the argument names (two ids only),
 * the alert on `choose_settings_invalid` only (AC-8), the replay, and the event (AC-16).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  alert: vi.fn(),
  warn: vi.fn(),
  report: vi.fn(),
  requireRole: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc, from: m.from })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));

import { chooseProviderAction } from '@/actions/requests';
import { chooseProvider, loadOffers } from '@/lib/requests';

const USER = '00000000-0000-4000-8000-0000000000c1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const APPLICATION = '00000000-0000-4000-8000-0000000000e1';
const OFFER = {
  application_id: APPLICATION,
  display_name: 'Ayşe K.',
  first_name: 'Ayşe',
  approved_since: '2026-03-01',
  message: 'I am free all week and live close by.',
  message_hidden: false,
  created_at: '2026-11-17T08:05:00+00:00',
};
const OFFERS = {
  status: 'OPEN',
  timezone: 'Europe/Istanbul',
  payment_window_hours: 24,
  selected_at: null,
  payment_deadline: null,
  cancelled_at: null,
  offers: [OFFER],
  chosen: null,
};
const CHOSEN = {
  status: 'ok',
  replayed: false,
  selected_at: '2026-11-17T09:00:00.123456+00:00',
  payment_deadline: '2026-11-18T09:00:00.123456+00:00',
};
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001' } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ id: USER, role: 'customer', region: 'TR' });
});

describe('loadOffers (AC-2)', () => {
  it('reads nothing for a malformed id and maps null to no request', async () => {
    expect(await loadOffers('not-a-uuid')).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadOffers(REQUEST)).toBeNull();
    expect(m.rpc).toHaveBeenCalledWith('request_offers', { p_request_id: REQUEST });
  });

  it('parses the offers and the chosen one', async () => {
    m.rpc.mockResolvedValue({
      data: {
        ...OFFERS,
        status: 'SELECTED',
        offers: [],
        chosen: { ...OFFER, status: 'SELECTED', suspended: false },
      },
      error: null,
    });
    expect((await loadOffers(REQUEST))?.chosen?.status).toBe('SELECTED');
  });

  it('refuses an offer carrying a key the function must never send', async () => {
    m.rpc.mockResolvedValue({ data: { ...OFFERS, offers: [{ ...OFFER, provider_id: USER }] }, error: null });
    await expect(loadOffers(REQUEST)).rejects.toThrow();
    m.rpc.mockResolvedValue({
      data: { ...OFFERS, offers: [{ ...OFFER, phone: '+905550000000' }] },
      error: null,
    });
    await expect(loadOffers(REQUEST)).rejects.toThrow();
  });
});

describe('chooseProvider (AC-7, AC-8)', () => {
  it('sends the two ids only and returns the stored deadline', async () => {
    m.rpc.mockResolvedValue({ data: CHOSEN, error: null });
    const outcome = await chooseProvider(
      { requestId: REQUEST, applicationId: APPLICATION },
      { region: 'TR', userId: USER },
    );
    expect(m.rpc).toHaveBeenCalledWith('choose_provider', {
      p_request_id: REQUEST,
      p_application_id: APPLICATION,
    });
    expect(outcome).toEqual({
      ok: true,
      replayed: false,
      selectedAt: CHOSEN.selected_at,
      paymentDeadline: CHOSEN.payment_deadline,
    });
  });

  it('alerts on a missing window only', async () => {
    m.rpc.mockResolvedValue(refuse('choose_settings_invalid'));
    expect(
      await chooseProvider(
        { requestId: REQUEST, applicationId: APPLICATION },
        { region: 'TR', userId: USER },
      ),
    ).toEqual({
      ok: false,
      code: 'choose_settings_invalid',
    });
    expect(m.alert).toHaveBeenCalledWith('choose_settings_invalid', { recordId: REQUEST, region: 'TR' });
    m.alert.mockClear();
    m.rpc.mockResolvedValue(refuse('offer_unavailable'));
    await chooseProvider({ requestId: REQUEST, applicationId: APPLICATION }, { region: 'TR', userId: USER });
    expect(m.alert).not.toHaveBeenCalled();
  });
});

describe('chooseProviderAction', () => {
  it('maps a refusal to its code with no Sentry report', async () => {
    m.rpc.mockResolvedValue(refuse('not_choosable'));
    expect(await chooseProviderAction({ requestId: REQUEST, applicationId: APPLICATION })).toEqual({
      success: false,
      error: 'not_choosable',
    });
    expect(m.report).not.toHaveBeenCalled();
  });

  it('refuses an unknown key before any database call', async () => {
    expect(
      await chooseProviderAction({
        requestId: REQUEST,
        applicationId: APPLICATION,
        paymentDeadline: 'tomorrow',
      }),
    ).toEqual({ success: false, error: 'validation_failed' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('revalidates after a new choose, not after a replay, and asks for the customer or admin role', async () => {
    m.rpc.mockResolvedValueOnce({ data: { ...CHOSEN, replayed: true }, error: null });
    expect(await chooseProviderAction({ requestId: REQUEST, applicationId: APPLICATION })).toMatchObject({
      success: true,
      data: { replayed: true },
    });
    expect(m.revalidate).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({ data: CHOSEN, error: null });
    await chooseProviderAction({ requestId: REQUEST, applicationId: APPLICATION });
    expect(m.revalidate).toHaveBeenCalledWith('/', 'layout');
    expect(m.requireRole).toHaveBeenCalledWith('customer', 'admin');
  });
});
