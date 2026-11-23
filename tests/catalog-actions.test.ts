import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0007, the action layer of position 03: what the catalog and pricing Server Actions do around the
 * database. The rules themselves are proven in pgTAP (09 to 11); here the database is a stub, so each
 * branch can be driven on purpose: zero rows back is `forbidden` (a demoted admin, AC-14), Postgres codes
 * map to stable codes, money is parsed on the server from text (AC-22), and a value that does not parse
 * becomes the card's `modifier_malformed`, never a guess.
 */

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  report: vi.fn(),
  insertRow: vi.fn(),
  updateRow: vi.fn(),
  moveRow: vi.fn(),
  parentRegion: vi.fn(),
  adminRegion: vi.fn(),
  previewInDb: vi.fn(),
  publishInDb: vi.fn(),
}));

vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/catalog/queries', () => ({ adminRegion: m.adminRegion }));
vi.mock('@/lib/catalog/writes', async (original) => {
  const real = await original<typeof import('@/lib/catalog/writes')>();
  return {
    ...real,
    insertRow: m.insertRow,
    updateRow: m.updateRow,
    moveRow: m.moveRow,
    parentRegion: m.parentRegion,
  };
});
vi.mock('@/lib/pricing', () => ({ previewFormula: m.previewInDb, publishFormula: m.publishInDb }));

import { saveAddon, saveCategory, saveQuestion, saveZone, setCatalogActive } from '@/actions/admin-catalog';
import { previewFormula, publishFormula } from '@/actions/admin-pricing';
import { catalogCode, ZeroRows } from '@/lib/catalog/writes';
import { AuthRefusal } from '@/lib/auth/session';

const ADMIN = { id: '00000000-0000-4000-8000-0000000000d1', role: 'admin' as const, region: 'TR' as const };
const ID = '00000000-0000-4000-8000-000000000501';
const CATEGORY = '00000000-0000-4000-8000-000000000c01';

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(ADMIN);
  m.adminRegion.mockResolvedValue({ region: 'TR', defaultLocale: 'tr' });
  m.parentRegion.mockResolvedValue('TR');
  m.insertRow.mockResolvedValue(ID);
});

describe('catalog writes', () => {
  it('only an admin may call them', async () => {
    await saveCategory({ name: { tr: 'Temizlik' } });
    expect(m.requireRole).toHaveBeenCalledWith('admin');
  });

  it('a customer or provider is refused before any write', async () => {
    m.requireRole.mockRejectedValue(new AuthRefusal('forbidden'));
    expect(await saveCategory({ name: { tr: 'Temizlik' } })).toEqual({ success: false, error: 'forbidden' });
    expect(
      await publishFormula({ serviceId: ID, expectedVersion: 0, basePrice: '1', modifiers: [] }),
    ).toEqual({
      success: false,
      error: 'forbidden',
    });
    expect(m.insertRow).not.toHaveBeenCalled();
    expect(m.publishInDb).not.toHaveBeenCalled();
  });

  it('a new category takes the active region, read on the server, and drops blank locales', async () => {
    expect(await saveCategory({ name: { tr: ' Temizlik ', en: '', ar: '  ' } })).toEqual({
      success: true,
      data: { id: ID },
    });
    expect(m.insertRow).toHaveBeenCalledWith(
      'service_categories',
      { region: 'TR', name: { tr: 'Temizlik' } },
      'TR',
    );
  });

  it('refuses a name over 120 code points before the database', async () => {
    expect(await saveCategory({ name: { tr: 'ş'.repeat(121) } })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(m.insertRow).not.toHaveBeenCalled();
  });

  it('zero rows back from an update is forbidden, not a silent success (AC-14)', async () => {
    m.updateRow.mockRejectedValue(new ZeroRows());
    expect(
      await saveZone({ id: ID, name: { tr: 'Merkez' }, multiplier: '1.15', il: 'İstanbul', ilce: 'Kadıköy' }),
    ).toEqual({
      success: false,
      error: 'forbidden',
    });
    expect(m.report).not.toHaveBeenCalled();
  });

  it('parses an addon price from text into minor units, on the server', async () => {
    await saveAddon({ serviceId: CATEGORY, name: { tr: 'Cam' }, price: '400,50' });
    expect(m.insertRow).toHaveBeenCalledWith(
      'addons',
      { service_id: CATEGORY, region: 'TR', name: { tr: 'Cam' }, price: 40050 },
      CATEGORY,
    );
    expect(await saveAddon({ serviceId: CATEGORY, name: { tr: 'Cam' }, price: '1.234' })).toEqual({
      success: false,
      error: 'validation_failed',
    });
  });

  it('sends a zone multiplier as canonical text, never rounded', async () => {
    await saveZone({ name: { tr: 'Merkez' }, multiplier: '1,10', il: 'İstanbul', ilce: 'Kadıköy' });
    expect(m.insertRow).toHaveBeenCalledWith(
      'zones',
      { region: 'TR', name: { tr: 'Merkez' }, multiplier: '1.1', il: 'İstanbul', ilce: 'Kadıköy' },
      'TR',
    );
    // Spec 0011-20b AC-1, X-15: il and ilçe are trimmed and required by the one schema.
    expect(await saveZone({ name: { tr: 'Merkez' }, multiplier: '1.10', il: ' ', ilce: 'Kadıköy' })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(
      await saveZone({ name: { tr: 'Merkez' }, multiplier: '1.155', il: 'İstanbul', ilce: 'Kadıköy' }),
    ).toEqual({
      success: false,
      error: 'validation_failed',
    });
  });

  it('an edit never sends a question key, type or scope', async () => {
    await saveQuestion({
      id: ID,
      categoryId: CATEGORY,
      serviceId: null,
      key: 'rooms',
      type: 'number',
      label: { tr: 'Oda' },
      helpText: null,
      required: true,
      affectsPricing: true,
      options: null,
      validation: { min: 1, max: 10, step: 1 },
    });
    const patch = m.updateRow.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(
      ['affects_pricing', 'help_text', 'label', 'options', 'required', 'validation'].sort(),
    );
  });

  it('maps question_in_use from the guard', async () => {
    m.updateRow.mockRejectedValue({ code: 'P0001', message: 'question_in_use' });
    expect(await setCatalogActive({ table: 'questions', id: ID, active: false })).toEqual({
      success: false,
      error: 'question_in_use',
    });
  });

  it('refuses a table outside the allow list', async () => {
    expect(await setCatalogActive({ table: 'pricing_formulas', id: ID, active: false })).toEqual({
      success: false,
      error: 'validation_failed',
    });
  });

  it.each([
    [{ code: '23505' }, 'key_taken'],
    [{ code: '23514' }, 'validation_failed'],
    [{ code: '42501' }, 'forbidden'],
    [{ code: '22003' }, 'validation_failed'],
    [{ code: 'P0001', message: 'question_in_use' }, 'question_in_use'],
    [{ code: '08006' }, null],
  ])('maps %j to %j', (error, code) => {
    expect(catalogCode(error)).toBe(code);
  });

  it('reports an error nobody can act on', async () => {
    m.updateRow.mockRejectedValue({ code: '08006', message: 'connection reset' });
    expect(await setCatalogActive({ table: 'zones', id: ID, active: true })).toEqual({
      success: false,
      error: 'action_failed',
    });
    expect(m.report).toHaveBeenCalled();
  });
});

describe('pricing editor', () => {
  const MODS = [
    {
      questionKey: 'rooms',
      matchType: 'always',
      matchValue: null,
      effectType: 'PER_UNIT',
      amount: '400',
      factor: null,
    },
    {
      questionKey: 'type',
      matchType: 'equals',
      matchValue: 'villa',
      effectType: 'MULTIPLIER',
      amount: null,
      factor: '1,30',
    },
    {
      questionKey: 'type',
      matchType: 'equals',
      matchValue: 'studio',
      effectType: 'FIXED',
      amount: '-400',
      factor: null,
    },
  ];

  it('turns typed amounts into minor units and factors into canonical text', async () => {
    m.publishInDb.mockResolvedValue({ ok: true, formulaId: ID, version: 2 });
    expect(
      await publishFormula({ serviceId: ID, expectedVersion: 1, basePrice: '1200', modifiers: MODS }),
    ).toEqual({
      success: true,
      data: { status: 'ok', version: 2 },
    });
    expect(m.publishInDb).toHaveBeenCalledWith({
      serviceId: ID,
      expectedVersion: 1,
      basePrice: 120000,
      modifiers: [
        {
          question_key: 'rooms',
          match_type: 'always',
          match_value: null,
          effect_type: 'PER_UNIT',
          amount: 40000,
          factor: null,
        },
        {
          question_key: 'type',
          match_type: 'equals',
          match_value: 'villa',
          effect_type: 'MULTIPLIER',
          amount: null,
          factor: '1.3',
        },
        {
          question_key: 'type',
          match_type: 'equals',
          match_value: 'studio',
          effect_type: 'FIXED',
          amount: -40000,
          factor: null,
        },
      ],
    });
  });

  it("a value that does not parse is its card's modifier_malformed, and nothing reaches the database", async () => {
    const bad = [
      { ...MODS[0], amount: '-400' },
      { ...MODS[1], factor: '1.23456' },
    ];
    expect(
      await publishFormula({ serviceId: ID, expectedVersion: 1, basePrice: 'x', modifiers: bad }),
    ).toEqual({
      success: true,
      data: {
        status: 'invalid_formula',
        errors: [
          { index: null, code: 'base_price_out_of_range' },
          { index: 1, code: 'modifier_malformed' },
          { index: 2, code: 'modifier_malformed' },
        ],
      },
    });
    expect(m.publishInDb).not.toHaveBeenCalled();
  });

  it('maps stale_formula and no_changes', async () => {
    m.publishInDb.mockResolvedValue({ ok: false, code: 'stale_formula' });
    expect(
      await publishFormula({ serviceId: ID, expectedVersion: 0, basePrice: '1', modifiers: [] }),
    ).toEqual({
      success: false,
      error: 'stale_formula',
    });
    m.publishInDb.mockResolvedValue({ ok: false, code: 'no_changes' });
    expect(
      await publishFormula({ serviceId: ID, expectedVersion: 1, basePrice: '1', modifiers: [] }),
    ).toEqual({
      success: true,
      data: { status: 'no_changes' },
    });
  });

  it('a preview past the ceiling or on broken settings comes back as a status the panel explains', async () => {
    m.previewInDb.mockResolvedValue({ ok: false, code: 'price_out_of_range' });
    const input = { serviceId: ID, basePrice: '1', modifiers: [], zoneId: null, addonIds: [], answers: {} };
    expect(await previewFormula(input)).toEqual({ success: true, data: { status: 'price_out_of_range' } });
    m.previewInDb.mockResolvedValue({ ok: false, code: 'pricing_settings_invalid' });
    expect(await previewFormula(input)).toEqual({
      success: true,
      data: { status: 'pricing_settings_invalid' },
    });
  });
});
