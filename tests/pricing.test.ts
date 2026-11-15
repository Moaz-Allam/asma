import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0007, admin's door to the pricing engine (`lib/pricing`). The engine itself is proven in pgTAP
 * (10, 11); here the database answers are stubs, so each branch of the door can be driven on purpose: no
 * alert from a preview, the parse of each result, and the formula errors. The customer's quote, with its
 * alert and log (AC-8, AC-24), moved to `lib/requests` in 04 (spec 0008): see `tests/requests.test.ts`.
 */

const m = vi.hoisted(() => ({ rpc: vi.fn(), alert: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })) }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));

import { previewFormula, publishFormula } from '@/lib/pricing';

const SERVICE = '00000000-0000-4000-8000-000000000501';
const ZONE = '00000000-0000-4000-8000-000000000201';

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
