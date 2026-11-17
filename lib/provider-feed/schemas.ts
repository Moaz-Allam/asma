import 'server-only';

import { z } from 'zod';

import { APPLICATION_STATUSES } from './constants';

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

export const RequestDetail = z
  .object({
    ...ShortDetails,
    ...Offers,
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
    request_status: z.string(),
    actual_started_at: Instant.nullable(),
    confirm_deadline: Instant.nullable(),
    closed_at: Instant.nullable(),
    can_start: z.boolean(),
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
  z.object({ status: z.literal('refused'), code: z.enum(['message_invalid', 'contact_info_in_message']) }),
]);
