import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLANK_CLASS, isBlankAnswer, trimBlank } from '@/lib/requests/blank';
import { decodeCursor, encodeCursor } from '@/lib/requests/cursor';
import { parseTab } from '@/lib/requests/input';
import { prefillFrom } from '@/lib/requests/prefill';
import type { RequestCatalog } from '@/lib/requests/schemas';

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
    join(process.cwd(), 'supabase/migrations/20261116090000_post_request.sql'),
    'utf8',
  );
  const sqlClasses = [...migration.matchAll(/'\^\[([^\]]+)\]\+\|\[([^\]]+)\]\+\$'/g)].flatMap((m) => [
    m[1],
    m[2],
  ]);

  it('is written four times in the migration, every copy the same, and equal to the TypeScript copy', () => {
    expect(sqlClasses).toHaveLength(4);
    for (const cls of sqlClasses) expect(ranges(cls ?? '')).toEqual(ranges(BLANK_CLASS));
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
