import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AGREEMENT_FIELDS,
  AgreementContentSchema,
  AgreementTemplateError,
  fieldValues,
  fillText,
  formatAgreementDay,
  formatAgreementInstant,
  formatAgreementMoney,
  labelText,
  NOT_GIVEN,
  type AgreementContent,
} from '@/lib/agreements/fields';
import { AgreementRenderError, renderAgreementPdf, TEXT_FEATURES } from '@/lib/agreements/render';
// @ts-expect-error fontkit (pdfkit's own layout engine) ships no types; the test reads only layout().glyphs.
import * as fontkit from 'fontkit';

/**
 * Spec 0011-20 AC-6, AC-14: the renderer. The draft-1 body is read from the migration that seeds it, so the test
 * renders exactly the text the database holds.
 */

const MIGRATION = 'supabase/migrations/20261204090000_service_agreement.sql';
const sql = readFileSync(MIGRATION, 'utf8');
const draft1 = JSON.parse(
  sql.slice(sql.indexOf('$json$[') + '$json$'.length, sql.lastIndexOf(']$json$') + 1),
) as {
  heading: string;
  paragraphs: string[];
}[];

// Spec 0011-20b AC-8, X-18: draft-2, seeded by the structured address migration.
const sql2 = readFileSync('supabase/migrations/20261206090000_structured_address.sql', 'utf8');
const draft2 = JSON.parse(
  sql2.slice(sql2.indexOf('$json$[') + '$json$'.length, sql2.lastIndexOf(']$json$') + 1),
) as {
  heading: string;
  paragraphs: string[];
}[];
const fieldsOf = (body: typeof draft1) =>
  new Set(
    body
      .flatMap((section) => [section.heading, ...section.paragraphs])
      .flatMap((text) => [...text.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1])),
  );

const content: AgreementContent = {
  agreement_number: 'HS-TR-2026-000042',
  agreement_date: '2026-11-23',
  timezone: 'Europe/Istanbul',
  unlocked_at: '2026-11-23T07:30:00.000Z',
  customer_name: 'Ayşe Gülşen Işıktaş',
  customer_phone: '+905551112233',
  provider_name: 'İlker Öztürk Temizlik Hizmetleri',
  provider_phone: '+905554445566',
  platform_name: 'Aldebyani',
  service_name: 'Ev temizliği',
  category_name: 'Temizlik',
  addon_names: ['Cam silme', 'Fırın içi'],
  district: 'Kadıköy',
  street_line: 'Moda Cad. No 9 Daire 4',
  scheduled_start: '2026-11-25T07:00:00.000Z',
  scheduled_end: '2026-11-25T10:00:00.000Z',
  job_price: 123450,
  commission: 12300,
  provider_fee: 6150,
  cash_due: 111150,
  currency: 'TRY',
  customer_accepted_at: '2026-11-23T07:10:00.000Z',
  provider_accepted_at: '2026-11-23T07:29:00.000Z',
  template_version: 'draft-1',
};

/** The ToUnicode maps of an uncompressed PDF, as one lower case string of hex code points. */
function toUnicode(bytes: Buffer): string {
  return bytes.toString('latin1').toLowerCase();
}

describe('agreement fields', () => {
  it('formats money once, in the Turkish style, from integer minor units', () => {
    expect(formatAgreementMoney(123450, 'TRY')).toBe('₺1.234,50');
    expect(formatAgreementMoney(0, 'TRY')).toBe('₺0,00');
    expect(formatAgreementMoney(5, 'TRY')).toBe('₺0,05');
    expect(formatAgreementMoney(100000000, 'TRY')).toBe('₺1.000.000,00');
    expect(() => formatAgreementMoney(1.5, 'TRY')).toThrow();
  });

  it('shows instants in the region time zone and the day without a shift', () => {
    expect(formatAgreementInstant('2026-11-25T07:00:00.000Z', 'Europe/Istanbul')).toBe('25 Kasım 2026 10:00');
    expect(formatAgreementDay('2026-11-23')).toBe('23 Kasım 2026');
  });

  it('substitutes every field of draft-1 and draft-2 and leaves no braces', () => {
    const values = fieldValues(content);
    const texts = [...draft1, ...draft2].flatMap((section) => [section.heading, ...section.paragraphs]);
    // draft-1 names every field but the three 20b added; draft-2 names those and every other but street_line.
    const added = ['customer_address', 'customer_directions', 'provider_address'];
    expect([...fieldsOf(draft1)].sort()).toEqual(AGREEMENT_FIELDS.filter((f) => !added.includes(f)).sort());
    expect([...fieldsOf(draft2)].sort()).toEqual(AGREEMENT_FIELDS.filter((f) => f !== 'street_line').sort());
    expect(draft2).toHaveLength(draft1.length);
    for (const text of texts) {
      const filled = fillText(text, values);
      expect(filled).not.toMatch(/\{\{|\}\}/);
    }
    expect(fillText('{{cash_due}} {{street_line}}', values)).toBe('₺1.111,50 Moda Cad. No 9 Daire 4');
  });

  it('prints both addresses and the directions, and falls back for content frozen before 20b (X-4)', () => {
    const before = fieldValues(content);
    expect(before.customer_address).toBe('Moda Cad. No 9 Daire 4');
    expect(before.customer_directions).toBe(NOT_GIVEN);
    expect(before.provider_address).toBe(NOT_GIVEN);
    const after = fieldValues(
      AgreementContentSchema.parse({
        ...content,
        template_version: 'draft-2',
        customer_address: 'Caferağa Mah., Moda Cad., No: 9, Daire: 4, 34710 Kadıköy/İstanbul',
        customer_directions: 'Mavi kapı, zile iki kez basın',
        provider_address: 'Rasimpaşa Mah., Rıhtım Cad., No: 3, Kadıköy/İstanbul',
      }),
    );
    expect(after.customer_address).toBe('Caferağa Mah., Moda Cad., No: 9, Daire: 4, 34710 Kadıköy/İstanbul');
    expect(after.customer_directions).toBe('Mavi kapı, zile iki kez basın');
    expect(after.provider_address).toBe('Rasimpaşa Mah., Rıhtım Cad., No: 3, Kadıköy/İstanbul');
    expect(AgreementContentSchema.parse({ ...content, provider_address: null }).provider_address).toBeNull();
  });

  it('refuses a name off the list (rule 8)', () => {
    expect(() => fillText('{{evil}}', fieldValues(content))).toThrow(AgreementTemplateError);
    expect(() => fillText('{{ customer_name }}', fieldValues(content))).toThrow(AgreementTemplateError);
  });

  it('keeps a value that happens to hold braces as plain text', () => {
    const values = fieldValues({ ...content, customer_name: 'Ad {{x}}' });
    expect(fillText('{{customer_name}}', values)).toBe('Ad {{x}}');
  });

  it('shows labels on the full text page, never sample data', () => {
    expect(labelText('{{customer_name}} öder {{cash_due}}.')).toBe(
      '[Hizmet alanın adı] öder [Nakit ödenecek tutar].',
    );
  });
});

describe('renderAgreementPdf', () => {
  it('renders a PDF with Noto Sans embedded and the Turkish glyphs in it', async () => {
    const { bytes } = await renderAgreementPdf({ content, sections: draft1, compress: false });
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = toUnicode(bytes);
    expect(text).toContain('/fontfile2');
    expect(text).toContain('notosans');
    expect(text).not.toContain('/helvetica');
    // ğ ş ı İ ö ü ç and the lira sign, in the ToUnicode maps of the embedded subsets.
    for (const code of ['011f', '015f', '0131', '0130', '00f6', '00fc', '00e7', '20ba']) {
      expect(text).toContain(`<${code}>`);
    }
  });

  it('lays text out with no ligatures, so a contract copies and searches exactly ("Taraflar" keeps f and l)', () => {
    const font = (
      fontkit as { openSync: (p: string) => { layout: (t: string, f?: unknown) => { glyphs: unknown[] } } }
    ).openSync('lib/agreements/fonts/NotoSans-Regular.ttf');
    expect(font.layout('Taraflar').glyphs.length).toBeLessThan(8);
    expect(font.layout('Taraflar', TEXT_FEATURES).glyphs.length).toBe(8);
  });

  it('renders the same bytes every time (the reveal time as the creation date)', async () => {
    const a = await renderAgreementPdf({ content, sections: draft1 });
    const b = await renderAgreementPdf({ content, sections: draft1 });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.bytes.length).toBeLessThan(1024 * 1024);
    expect(a.bytes.toString('latin1')).not.toContain('{{');
  });

  it('wraps a 200 character street line and a 120 character name', async () => {
    const long = {
      ...content,
      street_line: 'Ş'.repeat(40) + ' ' + 'Uzun Sokak Adı Mahallesi '.repeat(7).slice(0, 159),
      customer_name: 'Gülşen ' + 'Işıktaşoğlu'.repeat(11).slice(0, 113),
    };
    expect(long.street_line).toHaveLength(200);
    expect(long.customer_name).toHaveLength(120);
    const { bytes } = await renderAgreementPdf({ content: long, sections: draft1, compress: false });
    expect(bytes.length).toBeLessThan(1024 * 1024);
    // One line of 10.5 pt text holds about 90 characters at A4 width, so the long values wrap into more text runs
    // than the short ones.
    const short = await renderAgreementPdf({ content, sections: draft1, compress: false });
    const runs = (b: Buffer) => (b.toString('latin1').match(/\bTJ\b/g) ?? []).length;
    expect(runs(bytes)).toBeGreaterThan(runs(short.bytes));
  });

  it('refuses content or sections it cannot trust', async () => {
    await expect(
      renderAgreementPdf({ content: { ...content, job_price: 1.5 }, sections: draft1 }),
    ).rejects.toThrow(AgreementRenderError);
    await expect(renderAgreementPdf({ content, sections: [] })).rejects.toThrow(AgreementRenderError);
    await expect(
      renderAgreementPdf({ content: { ...content, extra: 'x' }, sections: draft1 }),
    ).rejects.toThrow(AgreementRenderError);
  });
});
