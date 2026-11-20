import 'server-only';

import { z } from 'zod';

import { REQUEST_STATUSES } from '@/lib/requests/schemas';
import { APPLICATION_STATUSES } from '@/lib/provider-feed/constants';

/**
 * What `admin_request_detail()` returns (spec 0011-12 AC-12). Strict at every level: the address is not part of
 * it, and a key the function starts sending by mistake fails the parse instead of reaching the page. Amounts are
 * integer minor units.
 */

const Localized = z.record(z.string(), z.string());
const Minor = z.number().int();
const Instant = z.string().min(1);
const Currency = z.enum(['TRY', 'SAR']);
const Id = z.string().uuid();

const Summary = z
  .object({
    id: Id,
    region: z.enum(['TR', 'KSA']),
    status: z.enum(REQUEST_STATUSES),
    customer_id: Id,
    service_name: Localized.nullable(),
    zone_name: Localized.nullable(),
    timezone: z.string(),
    fixed_price: Minor,
    commission_amount: Minor,
    cash_due: Minor,
    currency: Currency,
    scheduled_start_at: Instant,
    scheduled_end_at: Instant,
    created_at: Instant,
    selected_application_id: Id.nullable(),
    selected_at: Instant.nullable(),
    payment_deadline: Instant.nullable(),
    fee_deadline: Instant.nullable(),
    failed_picks: z.number().int().nonnegative(),
    cancelled_at: Instant.nullable(),
    cancelled_by: z.enum(['customer', 'provider', 'platform', 'admin']).nullable(),
    cancel_reason: z.string().nullable(),
    closed_at: Instant.nullable(),
    closed_by: z.enum(['customer', 'provider', 'platform', 'admin', 'auto']).nullable(),
    actual_started_at: Instant.nullable(),
    actual_completed_at: Instant.nullable(),
    confirm_deadline: Instant.nullable(),
  })
  .strict();

const Application = z
  .object({
    id: Id,
    provider_id: Id,
    provider_name: z.string().nullable(),
    status: z.enum(APPLICATION_STATUSES),
    selected: z.boolean(),
    created_at: Instant,
    status_changed_at: Instant,
    unlocked_at: Instant.nullable(),
    provider_fee_amount: Minor.nonnegative().nullable(),
  })
  .strict();

export const FEE_STATUSES = ['pending', 'paid', 'refunded'] as const;

const Fee = z
  .object({
    id: Id,
    kind: z.enum(['commission', 'provider_fee']),
    provider_id: Id.nullable(),
    application_id: Id.nullable(),
    amount: Minor.nonnegative(),
    currency: Currency,
    status: z.enum(FEE_STATUSES),
    paid_at: Instant.nullable(),
    psp_payment_id: z.string().nullable(),
    psp_fee_amount: Minor.nullable(),
    created_at: Instant,
  })
  .strict();
export type AdminFee = z.infer<typeof Fee>;

export const REFUND_STATUSES = ['queued', 'done', 'failed', 'done_by_hand'] as const;

const Refund = z
  .object({
    id: Id,
    kind: z.enum(['fee', 'late']),
    fee_payment_id: Id.nullable(),
    psp_payment_id: z.string().nullable(),
    amount: Minor.nonnegative(),
    currency: Currency,
    reason: z.string().nullable(),
    status: z.enum(REFUND_STATUSES),
    requested_by: Id.nullable(),
    created_at: Instant,
    finished_at: Instant.nullable(),
  })
  .strict();
export type AdminRefund = z.infer<typeof Refund>;

const Journal = z
  .object({
    journal_id: Id,
    kind: z.enum(['fee_paid', 'fee_refund', 'late_received', 'late_refund']),
    key: z.string(),
    fee_payment_id: Id.nullable(),
    currency: Currency,
    created_at: Instant,
    entries: z.array(z.object({ account: z.string(), amount: Minor }).strict()),
  })
  .strict();

const Flag = z
  .object({
    id: Id,
    kind: z.enum(['start_late', 'completion_late']),
    raised_at: Instant,
    cleared_at: Instant.nullable(),
    cleared_by: Id.nullable(),
    note: z.string().nullable(),
  })
  .strict();

const AuditRow = z
  .object({
    id: z.union([z.number().int(), z.string()]),
    action: z.string(),
    actor_id: Id.nullable(),
    entity_type: z.string(),
    entity_id: z.string().nullable(),
    old_value: z.record(z.string(), z.unknown()).nullable(),
    new_value: z.record(z.string(), z.unknown()).nullable(),
    created_at: Instant,
  })
  .strict();

export const AdminRequestDetail = z
  .object({
    request: Summary,
    applications: z.array(Application),
    fees: z.array(Fee),
    refunds: z.array(Refund),
    ledger: z.array(Journal),
    flags: z.array(Flag),
    timeline: z.array(AuditRow),
  })
  .strict();
export type AdminRequestDetail = z.infer<typeof AdminRequestDetail>;

/** `admin_refund_fee()` (AC-8): the refund queued, or the existing one on a replay. */
export const AdminRefundResult = z
  .object({ status: z.literal('ok'), replayed: z.boolean(), fee_refund_id: Id })
  .strict();

/** `admin_mark_refund_done()` (AC-9, R-10): the journal posted, absent on a replay. */
export const AdminRefundDoneResult = z
  .object({ status: z.literal('ok'), replayed: z.boolean(), journal_id: Id.optional() })
  .strict();

/** `admin_requests()` (spec 0011-16 R-2): one page of the list, no name, phone, address or note. */
const ListRow = z
  .object({
    id: Id,
    region: z.enum(['TR', 'KSA']),
    status: z.enum(REQUEST_STATUSES),
    service_name: Localized.nullable(),
    zone_name: Localized.nullable(),
    created_at: Instant,
    scheduled_start_at: Instant,
    fixed_price: Minor,
    currency: Currency,
    timezone: z.string(),
    open_flags: z.array(z.enum(['start_late', 'completion_late'])),
    open_report: z.boolean(),
  })
  .strict();
export type AdminListRow = z.infer<typeof ListRow>;

export const AdminRequestList = z
  .object({ rows: z.array(ListRow), total: z.number().int().nonnegative() })
  .strict();
export type AdminRequestList = z.infer<typeof AdminRequestList>;

/** `admin_flags()` (R-7): open flags, oldest first. */
const FlagRow = z
  .object({
    id: Id,
    kind: z.enum(['start_late', 'completion_late']),
    raised_at: Instant,
    request_id: Id,
    region: z.enum(['TR', 'KSA']),
    request_status: z.enum(REQUEST_STATUSES),
    timezone: z.string(),
  })
  .strict();
export type AdminFlagRow = z.infer<typeof FlagRow>;

export const AdminFlagQueue = z
  .object({ rows: z.array(FlagRow), total: z.number().int().nonnegative() })
  .strict();
export type AdminFlagQueue = z.infer<typeof AdminFlagQueue>;

/** `admin_cancel_request()` (R-3, X-9): ok, or a replay of admin's own cancel. Never a refund (row 11). */
export const AdminCancelResult = z.object({ status: z.literal('ok'), replayed: z.boolean() }).strict();

/** `admin_extend_deadline()` (R-5): the new deadline. */
export const AdminExtendResult = z
  .object({ status: z.literal('ok'), which: z.enum(['payment', 'fee', 'confirm']), deadline: Instant })
  .strict();

/** `admin_clear_flag()` (R-7). */
export const AdminClearResult = z.object({ status: z.literal('ok'), flag_id: Id }).strict();

/** `admin_request_address()` (R-8): the street line, only to the client component that asked. */
export const AdminAddressResult = z.object({ line: z.string().min(1) }).strict();
