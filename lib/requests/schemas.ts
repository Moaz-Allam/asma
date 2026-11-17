import 'server-only';

import { z } from 'zod';

import { AnswerErrors, Breakdown, PricedResult } from '@/lib/pricing/schemas';

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

/**
 * A refusal the caller caused in the engine, returned instead of raised so it counts against the hourly
 * limit (0009's migration, R10 A1).
 */
const EngineRefused = z.object({
  status: z.literal('refused'),
  code: z.enum(['service_unavailable', 'zone_unavailable', 'addon_unavailable', 'price_out_of_range']),
});

export const QuoteRequestResult = z.discriminatedUnion('status', [RequestQuote, AnswerErrors, EngineRefused]);

export const CreateRequestResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), id: z.string().uuid() }),
  AnswerErrors,
  z.object({ status: z.literal('price_changed'), quote: RequestQuote }),
  EngineRefused,
]);

/** What a stored request's pricing snapshot holds (AC-9): names in every locale admin wrote. */
export const PricingSnapshot = z.object({
  price: Minor,
  currency: z.enum(['TRY', 'SAR']),
  commission_percent: z.string(),
  rounding_minor: Minor,
  breakdown: Breakdown,
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
  region_info: z.object({ timezone: z.string() }),
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
  region_info: z.object({ timezone: z.string() }),
});
export type RequestDetailRow = z.infer<typeof RequestDetailRow>;

/**
 * One offer as the customer reads it (spec 0010 AC-2, AC-3): named fields only. A message the scanner of 06
 * would refuse comes back null, with `message_hidden` (AC-13).
 */
export const Offer = z
  .object({
    application_id: z.string().uuid(),
    display_name: z.string().nullable(),
    first_name: z.string().nullable(),
    approved_since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    message: z.string().nullable(),
    message_hidden: z.boolean(),
    created_at: z.string().min(1),
  })
  .strict();
export type Offer = z.infer<typeof Offer>;

/** `request_offers()` (AC-2): the offers while OPEN, the chosen one after a choose, and the dates. */
export const RequestOffers = z
  .object({
    status: z.enum(REQUEST_STATUSES),
    timezone: z.string(),
    payment_window_hours: z.number().int().nullable(),
    selected_at: z.string().nullable(),
    payment_deadline: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    offers: z.array(Offer),
    chosen: Offer.extend({
      status: z.string(),
      suspended: z.boolean(),
    })
      .strict()
      .nullable(),
  })
  .strict();
export type RequestOffers = z.infer<typeof RequestOffers>;

/** `choose_provider()` (AC-7): the same shape for a new choose and a replay. */
export const ChooseResult = z
  .object({
    status: z.literal('ok'),
    replayed: z.boolean(),
    selected_at: z.string().min(1),
    payment_deadline: z.string().min(1),
  })
  .strict();
