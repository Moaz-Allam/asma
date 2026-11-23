import 'server-only';

import { z } from 'zod';

import { REQUEST_STATUSES } from '@/lib/requests/schemas';

import { APPLICATION_QUESTION_TYPES, APPLICATION_STATUSES } from './constants';

/**
 * What the provider functions return (spec 0009 AC-7). Strict objects: a key the function starts sending
 * by mistake (a customer id, the notes) fails the parse instead of reaching a page.
 */

const Localized = z.record(z.string(), z.string());
const Minor = z.number().int();
const Instant = z.string().min(1);

export const OwnApplication = z
  .object({ id: z.string().uuid(), status: z.enum(APPLICATION_STATUSES), created_at: Instant })
  .strict();
export type OwnApplication = z.infer<typeof OwnApplication>;

const ShortDetails = {
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  zone_id: z.string().uuid(),
  service_name: Localized.nullable(),
  zone_name: Localized.nullable(),
  addon_names: z.array(Localized),
  scheduled_start_at: Instant,
  scheduled_end_at: Instant,
  fixed_price: Minor,
  cash_due: Minor,
  currency: z.enum(['TRY', 'SAR']),
};

const Offers = {
  applied_count: z.number().int(),
  cap: z.number().int(),
  full: z.boolean(),
  outside_hours: z.boolean(),
  application: OwnApplication.nullable(),
};

export const FeedRow = z.object({ ...ShortDetails, ...Offers }).strict();
export type FeedRow = z.infer<typeof FeedRow>;

export const FeedPage = z
  .object({ timezone: z.string(), has_more: z.boolean(), rows: z.array(FeedRow) })
  .strict();
export type FeedPage = z.infer<typeof FeedPage>;

export const StructuredAnswer = z
  .object({
    key: z.string(),
    label: Localized,
    type: z.enum(['single_select', 'multi_select', 'number', 'boolean', 'date', 'time']),
    value: z.union([z.number(), z.boolean(), z.string(), z.null()]),
    option_labels: z.array(Localized).nullable(),
  })
  .strict();
export type StructuredAnswer = z.infer<typeof StructuredAnswer>;

const QuestionKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const QuestionType = z.enum(APPLICATION_QUESTION_TYPES);

/** Spec 0011-19b AC-3: one active application question, as the apply form draws it. */
export const ApplicationQuestion = z
  .object({
    key: QuestionKey,
    label: Localized,
    help_text: Localized.nullable(),
    type: QuestionType,
    required: z.boolean(),
    options: z.array(z.object({ value: z.string(), label: Localized }).strict()).nullable(),
    max_length: z.number().int().positive().nullable(),
  })
  .strict();
export type ApplicationQuestion = z.infer<typeof ApplicationQuestion>;

/** Spec 0011-19b AC-4: what an application's answers answered, frozen at the apply (the chosen option only). */
export const SnapshotQuestion = z
  .object({
    key: QuestionKey,
    label: Localized,
    type: QuestionType,
    required: z.boolean(),
    choice: z.object({ value: z.string(), label: Localized }).strict().optional(),
  })
  .strict();
export type SnapshotQuestion = z.infer<typeof SnapshotQuestion>;

export const AnswerValue = z.union([z.string(), z.boolean()]);

/** Spec 0011-19b AC-3, X-8: the caller's own application on the request page, with its answers when it has them. */
export const RequestOwnApplication = z
  .object({
    ...OwnApplication.shape,
    application_answers: z.record(QuestionKey, AnswerValue).nullable(),
    questions_snapshot: z.array(SnapshotQuestion).nullable(),
  })
  .strict();
export type RequestOwnApplication = z.infer<typeof RequestOwnApplication>;

export const RequestDetail = z
  .object({
    ...ShortDetails,
    ...Offers,
    application: RequestOwnApplication.nullable(),
    questions: z.array(ApplicationQuestion).max(5),
    questions_version: z.string().nullable(),
    closed: z.boolean(),
    timezone: z.string(),
    answers: z.array(StructuredAnswer),
    // Spec 0010 AC-12: set only when the caller's own application is SELECTED.
    payment_deadline: Instant.nullable(),
  })
  .strict();
export type RequestDetail = z.infer<typeof RequestDetail>;

export const ApplicationListRow = z
  .object({ ...ShortDetails, application: OwnApplication, payment_deadline: Instant.nullable() })
  .strict();
export type ApplicationListRow = z.infer<typeof ApplicationListRow>;

/** `provider_jobs()` (spec 0011-10 R-11): one job, no contact field (the parse refuses one). */
export const JobRow = z
  .object({
    ...ShortDetails,
    application_id: z.string().uuid(),
    application_status: z.enum(APPLICATION_STATUSES),
    status_changed_at: Instant,
    provider_fee_amount: Minor.nonnegative().nullable(),
    unlocked_at: Instant.nullable(),
    payment_deadline: Instant.nullable(),
    fee_deadline: Instant.nullable(),
    // Spec 0011-11 R-5: the request's state, its work dates, and whether Started may be pressed now.
    // Security review S11-1: the request's state only for the caller's own selected, unlocked application.
    request_status: z.string().nullable(),
    actual_started_at: Instant.nullable(),
    confirm_deadline: Instant.nullable(),
    closed_at: Instant.nullable(),
    can_start: z.boolean(),
    // Spec 0011-20 AC-3: the version the customer accepted for this pick; null without an acceptance.
    agreement_version: z.string().nullable(),
  })
  .strict();
export type JobRow = z.infer<typeof JobRow>;

export const JobsPage = z
  .object({ timezone: z.string(), now: Instant, has_more: z.boolean(), rows: z.array(JobRow) })
  .strict();
export type JobsPage = z.infer<typeof JobsPage>;

/** `start_job()`, `finish_job()`, `confirm_job()`, `customer_mark_done()` (spec 0011-11 AC-2 to AC-5, R-3). */
export const JobMoveResult = z.object({ status: z.literal('ok'), replayed: z.boolean() }).strict();

/** `pay_provider_fee()` (spec 0011-10 AC-2): an attempt to wait on, or settled at once for a fee of 0. */
export const PayFeeResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('settled') }).strict(),
  z.object({ status: z.literal('checkout'), attempt_id: z.string().uuid(), reused: z.boolean() }).strict(),
]);

export const ApplicationsPage = z
  .object({ timezone: z.string(), has_more: z.boolean(), rows: z.array(ApplicationListRow) })
  .strict();
export type ApplicationsPage = z.infer<typeof ApplicationsPage>;

const Pick = z.object({
  id: z.string().uuid(),
  name: Localized,
  selected: z.boolean(),
  inactive: z.boolean(),
});

export const ProviderSetup = z
  .object({
    region: z.enum(['TR', 'KSA']),
    timezone: z.string(),
    complete: z.boolean(),
    categories: z.array(
      z.object({
        id: z.string().uuid(),
        name: Localized,
        services: z.array(Pick.extend({ note: Localized.nullable() })),
      }),
    ),
    zones: z.array(Pick),
    availability: z
      .object({
        work_days: z.array(z.number().int()),
        start_hour: z.number().int(),
        end_hour: z.number().int(),
      })
      .nullable(),
  })
  .strict();
export type ProviderSetup = z.infer<typeof ProviderSetup>;

export const HomeCounts = z
  .object({
    setup_complete: z.boolean(),
    open_requests: z.number().int(),
    applied: z.number().int(),
    selected: z.number().int(),
  })
  .strict();
export type HomeCounts = z.infer<typeof HomeCounts>;

export const ApplyResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), replayed: z.boolean(), application: OwnApplication }),
  z.object({
    status: z.literal('refused'),
    code: z.enum([
      'message_invalid',
      'contact_info_in_message',
      'questions_changed',
      'answers_invalid',
      'contact_info_in_answer',
    ]),
    key: QuestionKey.optional(),
  }),
]);

/**
 * Spec 0011-15 R-9: one row of the provider's jobs and fees history. Money only: no name, phone, address,
 * district or note, so a key the function starts sending by mistake fails the parse.
 */
export const HistoryRow = z
  .object({
    application_id: z.string().uuid(),
    request_id: z.string().uuid(),
    scheduled_start_at: Instant,
    service_name: Localized.nullable(),
    application_status: z.enum(APPLICATION_STATUSES),
    request_status: z.enum(REQUEST_STATUSES).nullable(),
    cash_due: Minor.nonnegative(),
    fee_amount: Minor.nonnegative(),
    receipt_id: z.string().uuid().nullable(),
    refund_state: z.enum(['none', 'pending', 'done']),
    refund_amount: Minor.positive().nullable(),
  })
  .strict();
export type HistoryRow = z.infer<typeof HistoryRow>;

const MonthStart = z.string().regex(/^\d{4}-\d{2}-01$/);

/** Spec 0011-15 R-5, X-3, X-4: the whole month's figures, summed in Postgres. None is a balance (rule 9). */
export const HistoryTotals = z
  .object({
    jobs: z.number().int().nonnegative(),
    fees_paid: Minor.nonnegative(),
    refunds: Minor.nonnegative(),
    net_fees: Minor,
    cash_closed: Minor.nonnegative(),
  })
  .strict();
export type HistoryTotals = z.infer<typeof HistoryTotals>;

export const History = z
  .object({
    month: MonthStart,
    timezone: z.string().min(1),
    currency: z.enum(['TRY', 'SAR']),
    months: z.array(MonthStart).min(1),
    totals: HistoryTotals,
    truncated: z.boolean(),
    rows: z.array(HistoryRow).max(200),
  })
  .strict();
export type History = z.infer<typeof History>;
