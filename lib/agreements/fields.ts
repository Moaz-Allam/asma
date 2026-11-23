import 'server-only';

import { z } from 'zod';

import { formatMinorFixed } from '@/lib/money/parse';

/**
 * The service agreement's fields (spec 0011-20, Template fields). A template paragraph may name only these, as
 * `{{name}}`; the database refuses any other (`agreement_text_valid`), and the renderer substitutes these and nothing
 * else (rule 8: nothing in a template is ever run). The content is frozen at the reveal as plain values (minor unit
 * integers, UTC instants); this module formats each one once, in Turkish, for the PDF.
 */

export const AGREEMENT_FIELDS = [
  'agreement_number',
  'agreement_date',
  'customer_name',
  'customer_phone',
  'provider_name',
  'provider_phone',
  'platform_name',
  'service_name',
  'category_name',
  'addon_names',
  'district',
  'street_line',
  'scheduled_start',
  'scheduled_end',
  'job_price',
  'commission',
  'provider_fee',
  'cash_due',
  'currency',
  'customer_accepted_at',
  'provider_accepted_at',
  'template_version',
] as const;
export type AgreementField = (typeof AGREEMENT_FIELDS)[number];

/** AC-12: the full text page shows each field as its Turkish label, never sample data. */
export const FIELD_LABELS_TR: Readonly<Record<AgreementField, string>> = {
  agreement_number: 'Sözleşme numarası',
  agreement_date: 'Sözleşme tarihi',
  customer_name: 'Hizmet alanın adı',
  customer_phone: 'Hizmet alanın telefonu',
  provider_name: 'Hizmet verenin adı',
  provider_phone: 'Hizmet verenin telefonu',
  platform_name: 'Platform',
  service_name: 'Hizmet',
  category_name: 'Kategori',
  addon_names: 'Ek hizmetler',
  district: 'Semt',
  street_line: 'Açık adres',
  scheduled_start: 'Planlanan başlangıç',
  scheduled_end: 'Planlanan bitiş',
  job_price: 'Hizmet bedeli',
  commission: 'Platform komisyonu',
  provider_fee: 'Hizmet veren ücreti',
  cash_due: 'Nakit ödenecek tutar',
  currency: 'Para birimi',
  customer_accepted_at: 'Hizmet alanın kabul zamanı',
  provider_accepted_at: 'Hizmet verenin kabul zamanı',
  template_version: 'Şablon sürümü',
};

const Minor = z.number().int().nonnegative().max(1_000_000_000_000_000);
const Instant = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'instant');
const Text = z.string().min(1).max(500);

/** `service_agreements.content` as the reveal wrote it (`queue_agreement`). */
export const AgreementContentSchema = z
  .object({
    agreement_number: z.string().regex(/^HS-[A-Z]{2,3}-\d{4}-\d{6}$/),
    agreement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(64),
    unlocked_at: Instant,
    customer_name: Text,
    customer_phone: z.string().min(3).max(32),
    provider_name: Text,
    provider_phone: z.string().min(3).max(32),
    platform_name: Text,
    service_name: Text.nullable(),
    category_name: Text.nullable(),
    addon_names: z.array(Text).max(50),
    district: Text.nullable(),
    street_line: z.string().min(1).max(1000).nullable(),
    scheduled_start: Instant,
    scheduled_end: Instant,
    job_price: Minor,
    commission: Minor,
    provider_fee: Minor,
    cash_due: Minor,
    currency: z.enum(['TRY', 'SAR']),
    customer_accepted_at: Instant,
    provider_accepted_at: Instant,
    template_version: z.string().regex(/^[a-z0-9._-]{1,40}$/),
  })
  .strict();
export type AgreementContent = z.infer<typeof AgreementContentSchema>;

/** A template's body (AC-1): 1 to 40 sections, each a heading and its paragraphs. */
export const AgreementSectionsSchema = z
  .array(
    z
      .object({
        heading: z.string().min(1).max(4000),
        paragraphs: z.array(z.string().min(1).max(4000)).min(1).max(40),
      })
      .strict(),
  )
  .min(1)
  .max(40);
export type AgreementSections = z.infer<typeof AgreementSectionsSchema>;

/** What a missing optional value prints as. */
export const NOT_GIVEN = 'Belirtilmedi';

/**
 * Money, once (rule 4): `formatMinorFixed` gives `1234.50` by integer arithmetic; the Turkish form groups the
 * thousands with a dot and uses a comma for the kuruş: `₺1.234,50`.
 */
export function formatAgreementMoney(minor: number, currency: 'TRY' | 'SAR'): string {
  const fixed = formatMinorFixed(minor);
  const [whole, frac] = fixed.split('.') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return currency === 'TRY' ? `₺${grouped},${frac}` : `${grouped},${frac} SAR`;
}

/** An instant as a Turkish date and time in the region's time zone: `25 Kasım 2026 10:00`. */
export function formatAgreementInstant(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')} ${get('hour')}:${get('minute')}`;
}

/** A calendar day (`2026-11-25`) as `25 Kasım 2026`, with no time zone shift. */
export function formatAgreementDay(day: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${day}T12:00:00Z`));
}

/** Every field's printed text, from the frozen content. */
export function fieldValues(content: AgreementContent): Readonly<Record<AgreementField, string>> {
  const tz = content.timezone;
  const money = (minor: number) => formatAgreementMoney(minor, content.currency);
  const instant = (iso: string) => formatAgreementInstant(iso, tz);
  return {
    agreement_number: content.agreement_number,
    agreement_date: formatAgreementDay(content.agreement_date),
    customer_name: content.customer_name,
    customer_phone: content.customer_phone,
    provider_name: content.provider_name,
    provider_phone: content.provider_phone,
    platform_name: content.platform_name,
    service_name: content.service_name ?? NOT_GIVEN,
    category_name: content.category_name ?? NOT_GIVEN,
    addon_names: content.addon_names.length > 0 ? content.addon_names.join(', ') : 'Yok',
    district: content.district ?? NOT_GIVEN,
    street_line: content.street_line ?? NOT_GIVEN,
    scheduled_start: instant(content.scheduled_start),
    scheduled_end: instant(content.scheduled_end),
    job_price: money(content.job_price),
    commission: money(content.commission),
    provider_fee: money(content.provider_fee),
    cash_due: money(content.cash_due),
    currency: content.currency,
    customer_accepted_at: instant(content.customer_accepted_at),
    provider_accepted_at: instant(content.provider_accepted_at),
    template_version: content.template_version,
  };
}

export class AgreementTemplateError extends Error {
  constructor(readonly code: 'unknown_field' | 'unfilled') {
    super(`agreement template: ${code}`);
    this.name = 'AgreementTemplateError';
  }
}

const FIELD = /\{\{([a-z_]+)\}\}/g;
const isField = (name: string): name is AgreementField =>
  (AGREEMENT_FIELDS as readonly string[]).includes(name);

/** One text with its listed fields substituted; anything else between braces is refused (rule 8). */
export function fillText(text: string, values: Readonly<Record<AgreementField, string>>): string {
  const filled = text.replace(FIELD, (_match, name: string) => {
    if (!isField(name)) throw new AgreementTemplateError('unknown_field');
    return values[name];
  });
  if (filled.includes('{{') || filled.includes('}}')) {
    // A value never carries braces; a leftover pair means the template held something that is not a field.
    if (/\{\{|\}\}/.test(text.replace(FIELD, ''))) throw new AgreementTemplateError('unfilled');
  }
  return filled;
}

/** One text with each field shown as its Turkish label in brackets (AC-12). */
export function labelText(text: string): string {
  return text.replace(FIELD, (match, name: string) => (isField(name) ? `[${FIELD_LABELS_TR[name]}]` : match));
}
