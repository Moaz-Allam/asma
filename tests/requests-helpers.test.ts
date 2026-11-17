import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLANK_CLASS, isBlankAnswer, trimBlank } from '@/lib/requests/blank';
import { decodeCursor, encodeCursor } from '@/lib/requests/cursor';
import { parseTab } from '@/lib/requests/input';
import { prefillFrom } from '@/lib/requests/prefill';
import type { RequestCatalog } from '@/lib/requests/schemas';
import { allowedDates, allowedHours, expectedEnd, quoteLines } from '@/lib/requests/view';

/**
 * Spec 0008: the pure pieces of `lib/requests`. The blank pattern's two copies agree (03's security Minor),
 * the cursor survives microseconds and refuses garbage (AC-13), and repeat drops what the catalog no longer
 * offers (AC-16).
 */

/** Code point ranges of a regex class written with \s, \uXXXX, \UXXXXXXXX or \u{X} escapes. */
function ranges(cls: string): string[] {
  const point = String.raw`\\(?:u\{([0-9A-Fa-f]+)\}|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8}))`;
  const re = new RegExp(`${point}(?:-${point})?|\\\\s`, 'g');
  const out: string[] = [];
  for (const m of cls.matchAll(re)) {
    if (m[0] === '\\s') {
      out.push('s');
      continue;
    }
    const lo = parseInt(m[1] ?? m[2] ?? m[3] ?? '', 16);
    const hi = m[4] ?? m[5] ?? m[6];
    out.push(hi === undefined ? lo.toString(16) : `${lo.toString(16)}-${parseInt(hi, 16).toString(16)}`);
  }
  return out;
}

describe('the blank pattern', () => {
  const migration = readFileSync(
    // Since 06 the class has one SQL source, blank_class(); blank_marks() is the same without whitespace.
    join(process.cwd(), 'supabase/migrations/20261118090000_choose_provider.sql'),
    'utf8',
  );
  const literal = (name: string) =>
    new RegExp(`function public\\.${name}\\(\\)[\\s\\S]*?select '([^']+)'::text`).exec(migration)?.[1] ?? '';

  it('has one SQL source, equal to the TypeScript copy, and the marks are the class without whitespace', () => {
    expect(ranges(literal('blank_class'))).toEqual(ranges(BLANK_CLASS));
    expect(ranges(literal('blank_marks'))).toEqual(ranges(BLANK_CLASS).filter((r) => r !== 's'));
    expect(migration.match(/'\^\[[^']*\]\+\|/g) ?? []).toHaveLength(0);
  });

  it('treats the invisible marks as blank', () => {
    for (const cp of [
      0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0xfe0f, 0xe0020, 0xe0101, 0x200b, 0xa0, 0xfeff,
    ]) {
      expect(trimBlank(String.fromCodePoint(cp, cp))).toBe('');
      expect(isBlankAnswer(String.fromCodePoint(cp))).toBe(true);
    }
    expect(trimBlank('ㅤ Moda ️')).toBe('Moda');
    expect(isBlankAnswer([])).toBe(true);
    expect(isBlankAnswer(null)).toBe(true);
    expect(isBlankAnswer(0)).toBe(false);
    expect(isBlankAnswer(false)).toBe(false);
    expect(isBlankAnswer(['a'])).toBe(false);
  });
});

describe('the list cursor', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('round trips, microseconds included', () => {
    const createdAt = '2026-11-15T10:00:00.123456+00:00';
    expect(decodeCursor(encodeCursor({ createdAt, id }))).toEqual({ createdAt, id });
  });

  it.each([undefined, '', 'garbage', 'x'.repeat(300), Buffer.from('2026|x').toString('base64url')])(
    'reads %s as page 1',
    (value) => {
      expect(decodeCursor(value)).toBeNull();
    },
  );

  it('refuses a cursor smuggling a filter', () => {
    const value = Buffer.from(`2026-11-15T10:00:00Z|${id}),status.eq.OPEN`).toString('base64url');
    expect(decodeCursor(value)).toBeNull();
  });
});

describe('tabs', () => {
  it('falls back to all', () => {
    expect(parseTab('active')).toBe('active');
    expect(parseTab('closed')).toBe('closed');
    expect(parseTab('ACTIVE')).toBe('all');
    expect(parseTab(['active'])).toBe('all');
    expect(parseTab(undefined)).toBe('all');
  });
});

describe('repeat prefill', () => {
  const SERVICE = 's1';
  const catalog: RequestCatalog = {
    region: 'TR',
    currency: 'TRY',
    timezone: 'Europe/Istanbul',
    today: '2026-11-15',
    schedule: { lead_days: 1, horizon_days: 14, first_hour: 8, last_hour: 18 },
    zones: [{ id: 'z1', name: { tr: 'Kadıköy' } }],
    categories: [
      {
        id: 'k1',
        name: { tr: 'Temizlik' },
        services: [
          {
            id: SERVICE,
            name: { tr: 'Ev' },
            note: null,
            hours_min: 3,
            hours_max: 5,
            addons: [{ id: 'a1', name: { tr: 'Cam' }, price: 40000 }],
            questions: [
              {
                key: 'rooms',
                type: 'number',
                label: { tr: 'Oda' },
                help_text: null,
                required: true,
                service_id: null,
                options: null,
                validation: { min: 1, max: 6, step: 1 },
              },
              {
                key: 'kind',
                type: 'single_select',
                label: { tr: 'Tip' },
                help_text: null,
                required: true,
                service_id: null,
                options: [{ value: 'flat', label: { tr: 'Daire' } }],
                validation: null,
              },
              {
                key: 'extras',
                type: 'multi_select',
                label: { tr: 'Ek' },
                help_text: null,
                required: false,
                service_id: null,
                options: [{ value: 'a', label: { tr: 'A' } }],
                validation: null,
              },
            ],
          },
        ],
      },
    ],
  };

  it('keeps what is still valid and drops the rest; never copies a date', () => {
    const prefill = prefillFrom(catalog, {
      serviceId: SERVICE,
      zoneId: 'z-gone',
      addonIds: ['a1', 'a-gone'],
      answers: { rooms: 9, kind: 'flat', extras: ['a', 'b'], retired: true },
      notes: 'Kapı kodu yok',
      addressLine: 'Moda Cad. No 5',
    });
    expect(prefill).toEqual({
      kind: 'prefilled',
      categoryId: 'k1',
      serviceId: SERVICE,
      zoneId: null,
      addonIds: ['a1'],
      answers: { kind: 'flat' },
      addressLine: 'Moda Cad. No 5',
      notes: 'Kapı kodu yok',
    });
  });

  it('opens at the category chips when the service is no longer bookable', () => {
    expect(
      prefillFrom(catalog, {
        serviceId: 'gone',
        zoneId: 'z1',
        addonIds: [],
        answers: {},
        notes: null,
        addressLine: null,
      }),
    ).toEqual({ kind: 'service_unavailable' });
  });
});

describe('the form helpers (spec 0008 AC-7, AC-8, AC-20)', () => {
  it('lists tomorrow to the horizon, across a month end', () => {
    const dates = allowedDates('2026-11-29', 1, 3);
    expect(dates).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
    expect(allowedHours(8, 10)).toEqual([8, 9, 10]);
  });

  it('puts the expected end on the next day past midnight', () => {
    expect(expectedEnd('2026-11-30', 18, 5)).toEqual({ date: '2026-11-30', hour: 23 });
    expect(expectedEnd('2026-12-31', 20, 6)).toEqual({ date: '2027-01-01', hour: 2 });
  });

  it('names the fired lines and never multiplies an amount', () => {
    const lines = quoteLines(
      {
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
          {
            question_key: 'kind',
            match_type: 'equals',
            match_value: 'villa',
            effect_type: 'MULTIPLIER',
            amount: null,
            factor: '1.30',
            units: null,
            fired: true,
          },
        ],
        addons: [{ id: 'a1', name: { tr: 'Cam' }, price: 40000 }],
        zone: { id: 'z2', name: { tr: 'Beşiktaş' }, multiplier: '1.15' },
        unrounded: '0',
        rounding_minor: 100,
      },
      { questions: { rooms: 'Rooms', kind: 'Type' }, addons: { a1: 'Windows' }, zones: { z2: 'Beşiktaş' } },
      { base: 'Home cleaning', adjustment: 'Adjustment' },
    );
    expect(lines).toEqual([
      { key: 'base', label: 'Home cleaning', amount: 120000 },
      { key: 'm0', label: 'Rooms', amount: 40000, units: 3 },
      { key: 'm1', label: 'Type', factor: '1.30' },
      { key: 'aa1', label: 'Windows', amount: 40000 },
      { key: 'zone', label: 'Beşiktaş', factor: '1.15' },
    ]);
  });
});

describe('pageview paths (spec 0008 AC-25)', () => {
  it('replace a request id with [id] and leave other paths alone', async () => {
    const { withoutIds } = await import('@/lib/analytics/client');
    expect(withoutIds('/tr/requests/0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('/tr/requests/[id]');
    expect(withoutIds('/ar/requests/0F8FAD5B-D9CB-469F-A165-70867728950E/x')).toBe('/ar/requests/[id]/x');
    expect(withoutIds('/en/requests/new')).toBe('/en/requests/new');
  });
});
