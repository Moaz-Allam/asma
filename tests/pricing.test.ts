import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0007, the app's door to the pricing engine (`lib/pricing`). The engine itself is proven in pgTAP
 * (10, 11); here the database answers are stubs, so each branch of the door can be driven on purpose: the
 * alert on `pricing_settings_invalid`, the log only on `price_out_of_range` (AC-8, AC-24), the parse of
 * each result, and an unknown error rethrown for `guardedAction` to report.
 */

const m = vi.hoisted(() => ({ rpc: vi.fn(), alert: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })) }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));

import { previewFormula, publishFormula, quotePrice } from '@/lib/pricing';

const SERVICE = '00000000-0000-4000-8000-000000000501';
const ZONE = '00000000-0000-4000-8000-000000000201';
const USER = '00000000-0000-4000-8000-0000000000c1';
const CONTEXT = { region: 'TR' as const, userId: USER };
const QUOTE = { serviceId: SERVICE, zoneId: ZONE, addonIds: [], answers: { rooms: 3 } };

const PRICED = {
  status: 'ok',
  price: 350000,
  currency: 'TRY',
  formula_id: '00000000-0000-4000-8000-000000000f01',
  formula_version: 1,
  breakdown: {
    base: 120000,
    modifiers: [
      {
        question_key: 'rooms',
        match_type: 'always',
        match_value: null,
        effect_type: 'PER_UNIT',
        amount: 40000,
        factor: null,
        units: 3,
        fired: true,
      },
    ],
    addons: [{ id: '00000000-0000-4000-8000-00000000a001', name: { tr: 'Cam' }, price: 40000 }],
    zone: { id: ZONE, name: { tr: 'Merkez' }, multiplier: '1.00' },
    unrounded: '350000.00',
    rounding_minor: 100,
  },
};

const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001' } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('quotePrice', () => {
  it('calls quote_price with answers and no price, and returns the parsed quote', async () => {
    m.rpc.mockResolvedValue({ data: PRICED, error: null });
    const outcome = await quotePrice(QUOTE, CONTEXT);
    expect(m.rpc).toHaveBeenCalledWith('quote_price', {
      p_service_id: SERVICE,
      p_zone_id: ZONE,
      p_addon_ids: [],
      p_answers: { rooms: 3 },
    });
    expect(
      Object.keys(m.rpc.mock.calls[0]?.[1] ?? {}).some((k) => /price|amount|total|fee|base/.test(k)),
    ).toBe(false);
    expect(outcome).toEqual({ ok: true, quote: PRICED });
  });

  it('raises the alert on pricing_settings_invalid, with the service id and the region (AC-24)', async () => {
    m.rpc.mockResolvedValue(refuse('pricing_settings_invalid'));
    expect(await quotePrice(QUOTE, CONTEXT)).toEqual({ ok: false, code: 'pricing_settings_invalid' });
    expect(m.alert).toHaveBeenCalledWith('pricing_settings_invalid', { recordId: SERVICE, region: 'TR' });
    expect(m.warn).not.toHaveBeenCalled();
  });

  it('only logs price_out_of_range, because a customer can reach it (AC-8)', async () => {
    m.rpc.mockResolvedValue(refuse('price_out_of_range'));
    expect(await quotePrice(QUOTE, CONTEXT)).toEqual({ ok: false, code: 'price_out_of_range' });
    expect(m.warn).toHaveBeenCalledWith('price_out_of_range', { region: 'TR', user_id: USER });
    expect(m.alert).not.toHaveBeenCalled();
  });

  it.each(['forbidden', 'service_unavailable', 'zone_unavailable', 'addon_unavailable'])(
    'maps %s to a code, with no alert and no log',
    async (code) => {
      m.rpc.mockResolvedValue(refuse(code));
      expect(await quotePrice(QUOTE, CONTEXT)).toEqual({ ok: false, code });
      expect(m.alert).not.toHaveBeenCalled();
      expect(m.warn).not.toHaveBeenCalled();
    },
  );

  it('returns answer errors with no price', async () => {
    const errors = [{ key: 'rooms', code: 'answer_out_of_range' }];
    m.rpc.mockResolvedValue({ data: { status: 'invalid', errors }, error: null });
    expect(await quotePrice(QUOTE, CONTEXT)).toEqual({ ok: false, code: 'invalid', errors });
  });

  it('rethrows an error it does not know', async () => {
    const error = { message: 'connection reset', code: '08006' };
    m.rpc.mockResolvedValue({ data: null, error });
    await expect(quotePrice(QUOTE, CONTEXT)).rejects.toBe(error);
  });

  it('refuses a result that does not match the output shape, never passing a wrong figure on', async () => {
    m.rpc.mockResolvedValue({ data: { ...PRICED, price: 3500.5 }, error: null });
    await expect(quotePrice(QUOTE, CONTEXT)).rejects.toThrow();
  });
});

describe('previewFormula', () => {
  const DRAFT = {
    serviceId: SERVICE,
    basePrice: 120000,
    modifiers: [],
    zoneId: null,
    addonIds: [],
    answers: {},
  };

  it('returns every line and raises no alert, even on pricing_settings_invalid', async () => {
    m.rpc.mockResolvedValue({ data: { ...PRICED, formula_id: null, formula_version: null }, error: null });
    const ok = await previewFormula(DRAFT);
    expect(ok.ok).toBe(true);
    m.rpc.mockResolvedValue(refuse('pricing_settings_invalid'));
    expect(await previewFormula(DRAFT)).toEqual({ ok: false, code: 'pricing_settings_invalid' });
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('returns formula errors for their cards', async () => {
    const errors = [{ index: 2, code: 'option_unknown' }];
    m.rpc.mockResolvedValue({ data: { status: 'invalid_formula', errors }, error: null });
    expect(await previewFormula(DRAFT)).toEqual({ ok: false, code: 'invalid_formula', errors });
  });
});

describe('publishFormula', () => {
  const DRAFT = { serviceId: SERVICE, expectedVersion: 0, basePrice: 120000, modifiers: [] };

  it('returns the new version', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'ok', formula_id: PRICED.formula_id, version: 1 },
      error: null,
    });
    expect(await publishFormula(DRAFT)).toEqual({ ok: true, formulaId: PRICED.formula_id, version: 1 });
    expect(m.rpc).toHaveBeenCalledWith('publish_pricing_formula', {
      p_service_id: SERVICE,
      p_expected_version: 0,
      p_base: 120000,
      p_modifiers: [],
    });
  });

  it('says no_changes, stale_formula and the formula errors', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'no_changes' }, error: null });
    expect(await publishFormula(DRAFT)).toEqual({ ok: false, code: 'no_changes' });
    m.rpc.mockResolvedValue(refuse('stale_formula'));
    expect(await publishFormula(DRAFT)).toEqual({ ok: false, code: 'stale_formula' });
    const errors = [{ index: null, code: 'base_price_out_of_range' }];
    m.rpc.mockResolvedValue({ data: { status: 'invalid_formula', errors }, error: null });
    expect(await publishFormula(DRAFT)).toEqual({ ok: false, code: 'invalid_formula', errors });
  });
});
