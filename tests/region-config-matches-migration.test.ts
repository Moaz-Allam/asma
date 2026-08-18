import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REGION_CONFIG, REGIONS } from '@/lib/region';

/**
 * The `regions` TABLE is the source of truth; `REGION_CONFIG` mirrors it so code
 * that runs before a query (choosing a PSP adapter, validating a dialling code at
 * signup) has the mapping. Two copies of the same fact drift silently — nothing
 * errors, the app simply starts charging the wrong PSP or rejecting a valid phone.
 *
 * This reads the seed straight out of the migration and asserts they agree.
 */
function seededRegions(): Record<string, string[]> {
  const dir = 'supabase/migrations';
  const file = readdirSync(dir).find((f) => f.endsWith('_regions_and_settings.sql'));
  if (!file) throw new Error('regions migration not found');
  const sql = readFileSync(`${dir}/${file}`, 'utf8');

  const block = /insert into public\.regions[^;]*?values([\s\S]*?)on conflict/i.exec(sql);
  if (!block?.[1]) throw new Error('could not locate the regions seed block');

  const rows: Record<string, string[]> = {};
  for (const m of block[1].matchAll(/\(([^)]*)\)/g)) {
    const cols = (m[1] ?? '').split(',').map((c) => c.trim().replace(/^'|'$/g, ''));
    const code = cols[0];
    if (code) rows[code] = cols;
  }
  return rows;
}

describe('REGION_CONFIG mirrors the regions table seed', () => {
  const seeded = seededRegions();

  it('seeds exactly the regions the code knows about', () => {
    expect(Object.keys(seeded).sort()).toEqual([...REGIONS].sort());
  });

  it.each([...REGIONS])('%s: currency, locale, psp and dial code all match', (region) => {
    const [, currency, defaultLocale, psp, dialCode] = seeded[region] ?? [];
    expect(currency).toBe(REGION_CONFIG[region].currency);
    expect(defaultLocale).toBe(REGION_CONFIG[region].defaultLocale);
    expect(psp).toBe(REGION_CONFIG[region].psp);
    expect(dialCode).toBe(REGION_CONFIG[region].dialCode);
  });
});
