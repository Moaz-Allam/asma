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
  /** Spec 0011-09 AC-6: the provider's fee window, set on SELECTED -> COMMISSION_PAID. */
  fee_deadline: z.string().nullable(),
  // Spec 0011-11 AC-8: the work dates and who closed the job.
  actual_started_at: z.string().nullable(),
  actual_completed_at: z.string().nullable(),
  confirm_deadline: z.string().nullable(),
  closed_at: z.string().nullable(),
  // Spec 0011-12 AC-1, R-13: a cancel closes too, by whoever cancelled.
  closed_by: z.enum(['customer', 'provider', 'platform', 'admin', 'auto']).nullable(),
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

/**
 * `pay_commission()` (spec 0011-09 AC-4): settled at once for a commission of 0, else the attempt the pay page
 * waits on, new or reused.
 */
export const PayResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('settled') }).strict(),
  z.object({ status: z.literal('checkout'), attempt_id: z.string().uuid(), reused: z.boolean() }).strict(),
]);

export const ATTEMPT_STATUSES = ['queued', 'ready', 'succeeded', 'failed', 'abandoned'] as const;
const FeeKind = z.enum(['commission', 'provider_fee']);
const FeeStatus = z.enum(['pending', 'paid', 'refunded']);

/**
 * `my_checkout()` (spec 0011-09 AC-7, R-3): one attempt as its payer reads it. Strict: a token, an IP or a PSP
 * payment id would fail the parse, never reach a page.
 */
export const CheckoutStatus = z
  .object({
    attempt_id: z.string().uuid(),
    request_id: z.string().uuid(),
    fee_kind: FeeKind,
    fee_status: FeeStatus,
    status: z.enum(ATTEMPT_STATUSES),
    reason: z.enum(['late', 'paused', 'failed']).nullable(),
    url: z.string().max(2000).nullable(),
    locale: z.enum(['ar', 'tr', 'en']).nullable(),
    late_refund: z.boolean(),
    // Spec 0011-10 R-1: the payer's own receipt number, the amount, the deadline that applies, and for a
    // provider fee the application the Try again button pays.
    fee_id: z.string().uuid(),
    amount: Minor.nonnegative(),
    deadline: z.string().min(1).nullable(),
    application_id: z.string().uuid().nullable(),
  })
  .strict();
export type CheckoutStatus = z.infer<typeof CheckoutStatus>;

/** `my_receipt()` (spec 0011-09 AC-13): our fee id is the receipt number; no PSP payment id. */
export const Receipt = z
  .object({
    receipt_number: z.string().uuid(),
    kind: FeeKind,
    amount: Minor.nonnegative(),
    currency: z.enum(['TRY', 'SAR']),
    status: z.enum(['paid', 'refunded']),
    paid_at: z.string().min(1),
    timezone: z.string(),
    request_id: z.string().uuid(),
    service_name: Localized,
    scheduled_start_at: z.string().min(1),
  })
  .strict();
export type Receipt = z.infer<typeof Receipt>;

/**
 * `request_contacts()` (spec 0011-10 AC-5): what one side reads of the other after both fees. Strict, per side:
 * the customer never receives an address field, and nothing outside these keys reaches a page.
 */
const ContactBase = {
  name: z.string().nullable(),
  phone: z.string().min(1),
  whatsapp: z.string().startsWith('https://wa.me/'),
  email: z.string().nullable(),
  email_confirmed: z.boolean(),
};
export const Contacts = z.discriminatedUnion('side', [
  z.object({ side: z.literal('customer'), ...ContactBase }).strict(),
  z
    .object({
      side: z.literal('provider'),
      ...ContactBase,
      street: z.string().nullable(),
      notes: z.string().nullable(),
      zone: Localized.nullable(),
      scheduled_start_at: z.string().min(1),
      scheduled_end_at: z.string().min(1),
      timezone: z.string(),
    })
    .strict(),
]);
export type Contacts = z.infer<typeof Contacts>;

/** `confirm_job()`, `customer_mark_done()` (spec 0011-11 AC-4, AC-5, R-3). */
export const CloseResult = z.object({ status: z.literal('ok'), replayed: z.boolean() }).strict();

/** `request_close_info()` (spec 0011-11 R-2, R-5): how the page words the close. */
export const CloseInfo = z.object({ auto_close_enabled: z.boolean(), can_mark_done: z.boolean() }).strict();
export type CloseInfo = z.infer<typeof CloseInfo>;

/** The commission row of a request, as its payer reads it through RLS (spec 0011-09 AC-10). */
export const CommissionFee = z
  .object({ id: z.string().uuid(), status: FeeStatus, paid_at: z.string().nullable() })
  .strict();
export type CommissionFee = z.infer<typeof CommissionFee>;

/**
 * `choose_provider()` (AC-7): the same shape for a new choose and a replay. Since 12 (spec 0011-12 AC-4, R-3) a
 * pick on a request whose commission is already paid carries it: no payment window, the provider's fee window
 * instead. Strict either way, and only those two shapes.
 */
export const ChooseResult = z.union([
  z
    .object({
      status: z.literal('ok'),
      replayed: z.boolean(),
      selected_at: z.string().min(1),
      payment_deadline: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal('ok'),
      replayed: z.boolean(),
      selected_at: z.string().min(1),
      payment_deadline: z.null(),
      carried: z.literal(true),
      fee_deadline: z.string().min(1),
    })
    .strict(),
]);

const Currency = z.enum(['TRY', 'SAR']);

/**
 * `cancel_request()`, `provider_cancel_job()` (spec 0011-12 AC-6): ok, and the refund queued when the matrix says
 * refund. The amount is the paid fee's own, never an input (AC-7).
 */
export const CancelResult = z
  .object({
    status: z.literal('ok'),
    refund: z
      .object({ fee_refund_id: z.string().uuid(), amount: Minor.nonnegative(), currency: Currency })
      .strict()
      .optional(),
  })
  .strict();

export const CANCEL_ACTORS = ['customer', 'provider'] as const;
export const COMMISSION_OUTCOMES = ['not_paid', 'refund', 'carry', 'none', 'by_hand'] as const;
export const PROVIDER_FEE_OUTCOMES = ['not_paid', 'none', 'by_hand'] as const;
export const COUNTS_AGAINST = [
  'nobody',
  'provider_cancellation',
  'provider_fee_follow_through',
  'customer_late_cancel',
  'provider_no_show',
  'admin_attribution',
] as const;

/**
 * `cancel_preview()` (spec 0011-12 AC-14): what a cancel would do now, for the dialog. The outcomes are the
 * matrix row's; the refund is the paid commission's own amount. Null outcomes once the request is cancelled.
 */
export const CancelPreview = z
  .object({
    actor: z.enum(CANCEL_ACTORS),
    state: z.enum(REQUEST_STATUSES),
    can_cancel: z.boolean(),
    checkout_open: z.boolean(),
    commission_outcome: z.enum(COMMISSION_OUTCOMES).nullable(),
    provider_fee_outcome: z.enum(PROVIDER_FEE_OUTCOMES).nullable(),
    counts_against: z.enum(COUNTS_AGAINST).nullable(),
    refund: z
      .object({ kind: z.literal('commission'), amount: Minor.nonnegative(), currency: Currency })
      .strict()
      .nullable(),
  })
  .strict();
export type CancelPreview = z.infer<typeof CancelPreview>;
