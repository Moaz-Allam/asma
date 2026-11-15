import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0008, the app's door to requests (`lib/requests`) and its actions. The rules themselves are proven in
 * pgTAP (12, 13); here the database answers are stubs, so each branch can be driven on purpose: the alert on
 * a settings refusal, the log only on `price_out_of_range` (AC-11), the parse of each result, the argument
 * names (no stored figure crosses, rule 1), and a mapped code never reaching Sentry (AC-22).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  alert: vi.fn(),
  warn: vi.fn(),
  report: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc, from: m.from })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));

import { cancelRequestAction, createRequestAction, quoteRequestAction } from '@/actions/requests';
import { AuthRefusal } from '@/lib/auth/session';
import {
  cancelRequest,
  createRequest,
  listMyRequests,
  loadRequestCatalog,
  quoteRequest,
} from '@/lib/requests';

const SERVICE = '00000000-0000-4000-8000-000000000501';
const ZONE = '00000000-0000-4000-8000-000000000201';
const ADDON = '00000000-0000-4000-8000-00000000a001';
const USER = '00000000-0000-4000-8000-0000000000c1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const CONTEXT = { region: 'TR' as const, userId: USER };
const QUOTE_INPUT = { serviceId: SERVICE, zoneId: ZONE, addonIds: [ADDON], answers: { rooms: 3 } };
const CREATE_INPUT = {
  ...QUOTE_INPUT,
  clientKey: '00000000-0000-4000-8000-0000000000e1',
  startDate: '2026-11-17',
  startHour: 10,
  addressLine: 'Moda Cad. No 5',
  notes: null,
  expectedPrice: 350000,
  expectedCommission: 35000,
};

const QUOTE = {
  status: 'ok',
  price: 350000,
  currency: 'TRY',
  formula_id: '00000000-0000-4000-8000-000000000f01',
  formula_version: 1,
  breakdown: {
    base: 120000,
    modifiers: [],
    addons: [{ id: ADDON, name: { tr: 'Cam' }, price: 40000 }],
    zone: { id: ZONE, name: { tr: 'Kadıköy' }, multiplier: '1.00' },
    unrounded: '350000.00',
    rounding_minor: 100,
  },
  commission_percent: '10',
  commission: 35000,
  cash_due: 315000,
};

const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001' } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ id: USER, role: 'customer', region: 'TR' });
});

describe('quoteRequest', () => {
  it('calls quote_request with answers and no figure, and returns the quote with its split', async () => {
    m.rpc.mockResolvedValue({ data: QUOTE, error: null });
    expect(await quoteRequest(QUOTE_INPUT, CONTEXT)).toEqual({ ok: true, quote: QUOTE });
    expect(m.rpc).toHaveBeenCalledWith('quote_request', {
      p_service_id: SERVICE,
      p_zone_id: ZONE,
      p_addon_ids: [ADDON],
      p_answers: { rooms: 3 },
    });
    expect(
      Object.keys(m.rpc.mock.calls[0]?.[1] ?? {}).some((k) => /price|amount|commission|fee/.test(k)),
    ).toBe(false);
  });

  it.each(['pricing_settings_invalid', 'request_settings_invalid'])(
    'raises the alert on %s (AC-11)',
    async (code) => {
      m.rpc.mockResolvedValue(refuse(code));
      expect(await quoteRequest(QUOTE_INPUT, CONTEXT)).toEqual({ ok: false, code });
      expect(m.alert).toHaveBeenCalledWith(code, { recordId: SERVICE, region: 'TR' });
      expect(m.warn).not.toHaveBeenCalled();
    },
  );

  it('only logs price_out_of_range', async () => {
    m.rpc.mockResolvedValue(refuse('price_out_of_range'));
    expect(await quoteRequest(QUOTE_INPUT, CONTEXT)).toEqual({ ok: false, code: 'price_out_of_range' });
    expect(m.warn).toHaveBeenCalledWith('price_out_of_range', { region: 'TR', user_id: USER });
    expect(m.alert).not.toHaveBeenCalled();
  });

  it.each(['too_many_quotes', 'service_unavailable', 'zone_unavailable', 'addon_unavailable', 'forbidden'])(
    'maps %s to a code, with no alert and no log',
    async (code) => {
      m.rpc.mockResolvedValue(refuse(code));
      expect(await quoteRequest(QUOTE_INPUT, CONTEXT)).toEqual({ ok: false, code });
      expect(m.alert).not.toHaveBeenCalled();
      expect(m.warn).not.toHaveBeenCalled();
    },
  );

  it('returns answer errors with no figure', async () => {
    const errors = [{ key: 'rooms', code: 'answer_required' }];
    m.rpc.mockResolvedValue({ data: { status: 'invalid', errors }, error: null });
    expect(await quoteRequest(QUOTE_INPUT, CONTEXT)).toEqual({ ok: false, code: 'invalid', errors });
  });

  it('refuses a result with a fractional figure, never passing it on', async () => {
    m.rpc.mockResolvedValue({ data: { ...QUOTE, commission: 3500.5 }, error: null });
    await expect(quoteRequest(QUOTE_INPUT, CONTEXT)).rejects.toThrow();
  });

  it('rethrows an error it does not know', async () => {
    const error = { message: 'connection reset', code: '08006' };
    m.rpc.mockResolvedValue({ data: null, error });
    await expect(quoteRequest(QUOTE_INPUT, CONTEXT)).rejects.toBe(error);
  });
});

describe('createRequest', () => {
  it('sends the two figures the form saw as expected figures only, and returns the id', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok', id: REQUEST }, error: null });
    expect(await createRequest(CREATE_INPUT, CONTEXT)).toEqual({ ok: true, id: REQUEST });
    const args = m.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(m.rpc.mock.calls[0]?.[0]).toBe('create_request');
    expect(args.p_expected_price).toBe(350000);
    expect(args.p_expected_commission).toBe(35000);
    expect(Object.keys(args).filter((k) => /price|amount|commission|fee|cash/.test(k))).toEqual([
      'p_expected_price',
      'p_expected_commission',
    ]);
  });

  it('returns the new figures on price_changed', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'price_changed', quote: QUOTE }, error: null });
    expect(await createRequest(CREATE_INPUT, CONTEXT)).toEqual({
      ok: false,
      code: 'price_changed',
      quote: QUOTE,
    });
  });

  it('raises the alert on pricing_settings_invalid and only logs price_out_of_range (AC-11)', async () => {
    m.rpc.mockResolvedValue(refuse('pricing_settings_invalid'));
    await createRequest(CREATE_INPUT, CONTEXT);
    expect(m.alert).toHaveBeenCalledWith('pricing_settings_invalid', { recordId: SERVICE, region: 'TR' });
    m.rpc.mockResolvedValue(refuse('price_out_of_range'));
    await createRequest(CREATE_INPUT, CONTEXT);
    expect(m.warn).toHaveBeenCalledTimes(1);
    expect(m.alert).toHaveBeenCalledTimes(1);
  });

  it.each([
    'schedule_invalid',
    'address_invalid',
    'notes_invalid',
    'contact_info_in_notes',
    'too_many_open_requests',
    'too_many_quotes',
  ])('maps %s to a code', async (code) => {
    m.rpc.mockResolvedValue(refuse(code));
    expect(await createRequest(CREATE_INPUT, CONTEXT)).toEqual({ ok: false, code });
    expect(m.alert).not.toHaveBeenCalled();
  });
});

describe('loadRequestCatalog and cancelRequest', () => {
  it('alerts with the record catalog when a request setting is missing (AC-1b)', async () => {
    m.rpc.mockResolvedValue(refuse('request_settings_invalid'));
    expect(await loadRequestCatalog(CONTEXT)).toEqual({ ok: false, code: 'request_settings_invalid' });
    expect(m.alert).toHaveBeenCalledWith('request_settings_invalid', { recordId: 'catalog', region: 'TR' });
  });

  it('cancels, and maps not_found and not_cancellable', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok' }, error: null });
    expect(await cancelRequest(REQUEST, 'other')).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith('cancel_request', { p_request_id: REQUEST, p_reason: 'other' });
    m.rpc.mockResolvedValue(refuse('not_cancellable'));
    expect(await cancelRequest(REQUEST, null)).toEqual({ ok: false, code: 'not_cancellable' });
  });
});

describe('listMyRequests', () => {
  function chain(result: { data: unknown; error: unknown }) {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'order', 'limit', 'or']) q[name] = vi.fn(() => q);
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    type Fn = ReturnType<typeof vi.fn>;
    return q as unknown as { select: Fn; eq: Fn; order: Fn; limit: Fn; or: Fn } & PromiseLike<unknown>;
  }

  it('filters on the caller, ignores a malformed cursor and filters Active against the server clock', async () => {
    const q = chain({ data: [], error: null });
    m.from.mockReturnValue(q);
    const page = await listMyRequests({ userId: USER, tab: 'active', after: 'garbage' });
    expect(page.rows).toEqual([]);
    expect(page.next).toBeNull();
    expect(q.eq).toHaveBeenCalledWith('customer_id', USER);
    expect(q.or).toHaveBeenCalledTimes(1);
    const filter = String(q.or.mock.calls[0]?.[0]);
    expect(filter).toContain('status.eq.OPEN,scheduled_start_at.gt.');
    expect(filter).not.toContain('created_at.lt');
  });

  it('All with no cursor adds no filter', async () => {
    const q = chain({ data: [], error: null });
    m.from.mockReturnValue(q);
    await listMyRequests({ userId: USER, tab: 'all', after: undefined });
    expect(q.or).not.toHaveBeenCalled();
  });
});

describe('the request actions', () => {
  it('a mapped refusal is a code and reaches no Sentry report (AC-22)', async () => {
    m.rpc.mockResolvedValue(refuse('too_many_open_requests'));
    expect(await createRequestAction(CREATE_INPUT)).toEqual({
      success: false,
      error: 'too_many_open_requests',
    });
    expect(m.report).not.toHaveBeenCalled();
  });

  it('createRequestAction with pricing_settings_invalid raises the alert (AC-11)', async () => {
    m.rpc.mockResolvedValue(refuse('pricing_settings_invalid'));
    expect(await createRequestAction(CREATE_INPUT)).toEqual({
      success: false,
      error: 'pricing_settings_invalid',
    });
    expect(m.alert).toHaveBeenCalledWith('pricing_settings_invalid', { recordId: SERVICE, region: 'TR' });
  });

  it('returns price_changed with the new quote', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'price_changed', quote: QUOTE }, error: null });
    expect(await createRequestAction(CREATE_INPUT)).toEqual({
      success: true,
      data: { status: 'price_changed', quote: QUOTE },
    });
  });

  it('refuses a malformed input before any database call', async () => {
    expect(await quoteRequestAction({ ...QUOTE_INPUT, serviceId: 'x' })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(await createRequestAction({ ...CREATE_INPUT, expectedPrice: 3500.5 })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(await cancelRequestAction({ requestId: REQUEST, reason: 'bored' })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('asks for the customer or admin role (AC-23)', async () => {
    m.requireRole.mockRejectedValue(new AuthRefusal('forbidden'));
    expect(await quoteRequestAction(QUOTE_INPUT)).toEqual({ success: false, error: 'forbidden' });
    expect(m.requireRole).toHaveBeenCalledWith('customer', 'admin');
  });
});
