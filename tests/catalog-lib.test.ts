import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0007, the small libraries of the catalog and pricing pages (review of PR #27, 2026-11-15): a rejected
 * action settles as `network`; Eastern digits fold for every integer field (AC-22); a draft compares with
 * the published formula as numbers in text; `localized()` picks a locale; `moveRow` renumbers only the rows
 * that changed; and the browser's match table equals the one `pricing_formula_errors` enforces.
 */

const db = vi.hoisted(() => ({
  rows: [] as { id: string; display_order: number; scope: string }[],
  updates: [] as unknown[],
}));

/** A stand in for the few PostgREST calls `moveRow` makes, over an in memory list. */
function fakeClient() {
  return {
    from: () => {
      let filter: { column: string; value: string } | null = null;
      let patch: Record<string, unknown> | null = null;
      const chain = {
        select: () => chain,
        update: (values: Record<string, unknown>) => {
          patch = values;
          return chain;
        },
        eq: (column: string, value: string) => {
          filter = { column, value };
          if (patch) {
            db.updates.push({ id: value, ...patch });
            const row = db.rows.find((r) => r.id === value);
            if (row) row.display_order = patch.display_order as number;
          }
          return chain;
        },
        order: () => chain,
        maybeSingle: async () => {
          const row = db.rows.find((r) => r.id === filter?.value);
          return { data: row ? { category_id: row.scope } : null, error: null };
        },
        then: (resolve: (value: unknown) => void) => {
          if (patch) return resolve({ data: [{ id: filter?.value }], error: null });
          const rows = db.rows
            .filter((r) => r.scope === filter?.value)
            .sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id));
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
}

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => fakeClient()) }));
vi.mock('@/lib/region/public', () => ({ getPublicRegions: vi.fn(async () => []) }));

import { canonicalDecimal, sameFormula } from '@/lib/catalog/compare';
import { foldDigits, minorTextToMajor, parseWhole } from '@/lib/catalog/digits';
import { asLocalizedText, localized, missingLocales } from '@/lib/catalog/localized';
import { MATCH_TABLE } from '@/lib/catalog/options';
import { twoDecimals } from '@/lib/catalog/queries';
import { latestOnly, settle } from '@/lib/catalog/settle';
import { moveRow } from '@/lib/catalog/writes';

describe('settle', () => {
  it('turns a rejected action, a dropped connection, into the network code', async () => {
    expect(await settle(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({
      success: false,
      error: 'network',
    });
  });

  it('passes a settled result through unchanged', async () => {
    expect(await settle(async () => ({ success: true as const, data: { id: 'x' } }))).toEqual({
      success: true,
      data: { id: 'x' },
    });
    expect(await settle(async () => ({ success: false as const, error: 'forbidden' }))).toEqual({
      success: false,
      error: 'forbidden',
    });
  });
});

describe('the late answer rule of the test panel', () => {
  it('drops an answer that comes back after a newer request was made', async () => {
    const latest = latestOnly();
    const shown: string[] = [];
    let release: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => (release = resolve));
    const ask = async (answer: Promise<string>) => {
      const ticket = latest.take();
      const value = await answer;
      if (latest.isLatest(ticket)) shown.push(value);
    };
    const first = ask(slow);
    const second = ask(Promise.resolve('newer'));
    await second;
    release('older');
    await first;
    expect(shown).toEqual(['newer']);
  });

  it('keeps the only answer, and a ticket taken without asking still retires the older one', () => {
    const latest = latestOnly();
    const one = latest.take();
    expect(latest.isLatest(one)).toBe(true);
    latest.take();
    expect(latest.isLatest(one)).toBe(false);
  });
});

describe('integer fields and the before rounding line', () => {
  it.each([
    ['3', 3],
    ['٣', 3],
    ['۱۲', 12],
    [' 10 ', 10],
    ['000', 0],
  ])('reads %j as %d', (text, value) => {
    expect(parseWhole(text)).toBe(value);
  });

  it.each(['3.5', '1e3', '+3', '', '-2', '1234567', 'x'])('refuses %j, never rounds or guesses', (text) => {
    expect(parseWhole(text)).toBeNull();
  });

  it('takes a sign only where one is allowed', () => {
    expect(parseWhole('-2', { allowNegative: true })).toBe(-2);
    expect(parseWhole('−٢', { allowNegative: true })).toBe(-2);
    expect(parseWhole('-0', { allowNegative: true })).toBe(0);
  });

  it('folds every Eastern digit and nothing else', () => {
    expect(foldDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ abc')).toBe('0123456789 0123456789 abc');
  });

  it.each([
    ['350000.0000', '3500.00'],
    ['350000', '3500.00'],
    ['1384.240000000000', '13.8424'],
    ['5', '0.05'],
    ['502550.000000', '5025.50'],
    ['-100', '-1.00'],
    ['oops', 'oops'],
  ])('writes %j minor units as %j major units, by moving the mark', (text, major) => {
    expect(minorTextToMajor(text)).toBe(major);
  });

  it('round trips every whole number of minor units through the text', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (minor) => {
        const [whole = '', frac = ''] = minorTextToMajor(String(minor)).split('.');
        expect(Number(`${whole}${frac.padEnd(2, '0').slice(0, 2)}`)).toBe(minor);
      }),
    );
  });
});

describe('a draft against the published formula', () => {
  const mod = (amount: string | null, factor: string | null) => ({
    questionKey: 'rooms',
    matchType: 'always',
    matchValue: null,
    effectType: factor === null ? 'PER_UNIT' : 'MULTIPLIER',
    amount,
    factor,
  });

  it.each([
    ['1.30', '1.3'],
    ['1200.00', '1200'],
    ['١٢٠٠', '1200'],
    ['1,5', '1.5'],
    ['007', '7'],
    ['-0', '0'],
  ])('reads %j as %j', (text, canonical) => {
    expect(canonicalDecimal(text)).toBe(canonical);
  });

  it('1.3 equals 1.30 and 1200 equals 1200.00', () => {
    expect(
      sameFormula(
        { base: '1200', modifiers: [mod(null, '1.3')] },
        { base: '1200.00', modifiers: [mod(null, '1.30')] },
      ),
    ).toBe(true);
  });

  it('a changed amount, a moved rule or a new rule is a difference', () => {
    const published = { base: '1200', modifiers: [mod('400', null), mod(null, '1.3')] };
    expect(sameFormula({ base: '1200', modifiers: [mod('450', null), mod(null, '1.3')] }, published)).toBe(
      false,
    );
    expect(sameFormula({ base: '1200', modifiers: [mod(null, '1.3'), mod('400', null)] }, published)).toBe(
      false,
    );
    expect(
      sameFormula({ base: '1200', modifiers: [...published.modifiers, mod('1', null)] }, published),
    ).toBe(false);
    expect(sameFormula({ base: '1201', modifiers: published.modifiers }, published)).toBe(false);
  });
});

describe('localized text', () => {
  it("picks the page's locale, then the region's default, then nothing", () => {
    expect(localized({ tr: 'Temizlik', en: 'Cleaning' }, 'en', 'tr')).toBe('Cleaning');
    expect(localized({ tr: 'Temizlik' }, 'ar', 'tr')).toBe('Temizlik');
    expect(localized({ tr: '  ' }, 'ar', 'tr')).toBe('');
    expect(localized(null, 'ar', 'tr')).toBe('');
  });

  it('names the locales a row lacks and keeps only the three known ones', () => {
    expect(missingLocales({ tr: 'Temizlik' })).toEqual(['ar', 'en']);
    expect(asLocalizedText({ tr: 'Temizlik', de: 'Reinigung', en: 5 })).toEqual({ tr: 'Temizlik' });
  });

  it('writes a zone multiplier with two decimals', () => {
    expect(twoDecimals(1)).toBe('1.00');
    expect(twoDecimals(1.15)).toBe('1.15');
    expect(twoDecimals(0.5)).toBe('0.50');
  });
});

describe('moveRow', () => {
  beforeEach(() => {
    db.updates = [];
    db.rows = [
      { id: 'a', display_order: 1, scope: 'c1' },
      { id: 'b', display_order: 2, scope: 'c1' },
      { id: 'c', display_order: 3, scope: 'c1' },
      { id: 'x', display_order: 1, scope: 'c2' },
    ];
  });

  it('swaps a row with its neighbour and writes only the two that changed', async () => {
    await moveRow('questions', 'c', 'up');
    expect(db.updates).toEqual([
      { id: 'c', display_order: 2 },
      { id: 'b', display_order: 3 },
    ]);
  });

  it('renumbers a tie left by a failed move, breaking it on id', async () => {
    db.rows[1]!.display_order = 1;
    await moveRow('questions', 'a', 'down');
    expect(db.rows.filter((r) => r.scope === 'c1').map((r) => [r.id, r.display_order])).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 3],
    ]);
  });

  it('does nothing past either end, and never touches another scope', async () => {
    await moveRow('questions', 'a', 'up');
    await moveRow('questions', 'c', 'down');
    expect(db.updates).toEqual([]);
    expect(db.rows.find((r) => r.id === 'x')!.display_order).toBe(1);
  });
});

describe('the match table', () => {
  it('equals the one pgTAP proves against pricing_formula_errors', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'tests', '10_pricing_engine.test.sql'), 'utf8');
    // The JSON between the two `$json$` quotes of `pg_temp.match_table()`.
    const block = /\$json\$\r?\n([\s\S]*?)\r?\n\$json\$/.exec(sql)?.[1];
    expect(block).toBeDefined();
    expect(JSON.parse(block!)).toEqual(MATCH_TABLE);
  });
});
