import 'server-only';

import { z } from 'zod';

import { AnswerErrors, PricedResult } from '@/lib/pricing/schemas';

/**
 * The shapes the request functions return (spec 0008, Feature design). Parsed on the server, so a change in
 * the database surfaces as an error here, never as a wrong figure on a page. Amounts are integer minor units;
 * text stays localised jsonb until a page picks its locale.
 */

const Localized = z.record(z.string(), z.string());
const Minor = z.number().int();

export const QUESTION_TYPES = [
  'number',
  'single_select',
  'multi_select',
  'boolean',
  'text',
  'textarea',
  'date',
  'time',
] as const;

export const CatalogQuestion = z.object({
  key: z.string(),
  type: z.enum(QUESTION_TYPES),
  label: Localized,
  help_text: Localized.nullable(),
  required: z.boolean(),
  service_id: z.string().nullable(),
  options: z.array(z.object({ value: z.string(), label: Localized })).nullable(),
  validation: z.record(z.string(), z.number()).nullable(),
});
export type CatalogQuestion = z.infer<typeof CatalogQuestion>;

export const CatalogService = z.object({
  id: z.string(),
  name: Localized,
  note: Localized.nullable(),
  hours_min: z.number().int(),
  hours_max: z.number().int(),
  questions: z.array(CatalogQuestion),
  addons: z.array(z.object({ id: z.string(), name: Localized, price: Minor.positive() })),
});
export type CatalogService = z.infer<typeof CatalogService>;

export const RequestCatalog = z.object({
  region: z.enum(['TR', 'KSA']),
  currency: z.enum(['TRY', 'SAR']),
  timezone: z.string(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schedule: z.object({
    lead_days: z.number().int(),
    horizon_days: z.number().int(),
    first_hour: z.number().int(),
    last_hour: z.number().int(),
  }),
  zones: z.array(z.object({ id: z.string(), name: Localized })),
  categories: z.array(z.object({ id: z.string(), name: Localized, services: z.array(CatalogService) })),
});
export type RequestCatalog = z.infer<typeof RequestCatalog>;

/** A quote with its split (AC-5): what `quote_price` returns plus the commission and the cash due. */
export const RequestQuote = PricedResult.extend({
  commission_percent: z.string(),
  commission: Minor.nonnegative(),
  cash_due: Minor.nonnegative(),
});
export type RequestQuote = z.infer<typeof RequestQuote>;

export const QuoteRequestResult = z.discriminatedUnion('status', [RequestQuote, AnswerErrors]);

export const CreateRequestResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), id: z.string().uuid() }),
  AnswerErrors,
  z.object({ status: z.literal('price_changed'), quote: RequestQuote }),
]);

/** What a stored request's pricing snapshot holds (AC-9): names in every locale admin wrote. */
export const PricingSnapshot = z.object({
  price: Minor,
  currency: z.enum(['TRY', 'SAR']),
  commission_percent: z.string(),
  rounding_minor: Minor,
  breakdown: z.object({
    modifiers: z.array(
      z
        .object({ question_key: z.string().nullable(), effect_type: z.string(), amount: Minor.nullable() })
        .passthrough(),
    ),
    addons: z.array(z.object({ id: z.string(), name: Localized, price: Minor })),
    zone: z.object({ id: z.string(), name: Localized, multiplier: z.string() }).nullable(),
  }),
  service: z.object({ id: z.string(), name: Localized, category_name: Localized }),
});
export type PricingSnapshot = z.infer<typeof PricingSnapshot>;

export const QuestionSnapshot = z.object({
  key: z.string(),
  type: z.enum(QUESTION_TYPES),
  label: Localized,
  options: z.array(z.object({ value: z.string(), label: Localized })).nullable(),
  required: z.boolean(),
});
export type QuestionSnapshot = z.infer<typeof QuestionSnapshot>;

export const REQUEST_STATUSES = [
  'OPEN',
  'SELECTED',
  'COMMISSION_PAID',
  'UNLOCKED',
  'IN_PROGRESS',
  'AWAITING_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const RequestListRow = z.object({
  id: z.string().uuid(),
  status: z.enum(REQUEST_STATUSES),
  fixed_price: Minor,
  currency: z.enum(['TRY', 'SAR']),
  scheduled_start_at: z.string(),
  created_at: z.string(),
  service: z.object({ id: z.string(), name: Localized, category_name: Localized }),
  zone_name: Localized.nullable(),
});
export type RequestListRow = z.infer<typeof RequestListRow>;

export const RequestDetailRow = z.object({
  id: z.string().uuid(),
  status: z.enum(REQUEST_STATUSES),
  service_id: z.string().uuid(),
  zone_id: z.string().uuid(),
  addon_ids: z.array(z.string().uuid()),
  answers: z.record(z.string(), z.unknown()),
  questions_snapshot: z.array(QuestionSnapshot),
  pricing_snapshot: PricingSnapshot,
  fixed_price: Minor,
  commission_amount: Minor,
  cash_due: Minor,
  currency: z.enum(['TRY', 'SAR']),
  scheduled_start_at: z.string(),
  scheduled_end_at: z.string(),
  notes: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancel_reason: z.enum(['plans_changed', 'found_elsewhere', 'price', 'other']).nullable(),
  created_at: z.string(),
});
export type RequestDetailRow = z.infer<typeof RequestDetailRow>;
