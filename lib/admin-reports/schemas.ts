import 'server-only';

import { z } from 'zod';

import { REPORT_OUTCOMES, REPORT_REASONS } from '@/lib/reports/constants';

/**
 * What the admin report functions return (spec 0011-14 AC-4, AC-5, X-21, X-22). Strict at every level, so a key a
 * function starts sending by mistake fails the parse instead of reaching the page.
 */

const Id = z.string().uuid();
const Instant = z.string().min(1);
const Localized = z.record(z.string(), z.string());
const Side = z.enum(['customer', 'provider']);
const Status = z.enum(['open', 'handled']);
const Outcome = z.enum(REPORT_OUTCOMES);
const Reason = z.enum(REPORT_REASONS);

export const ReportRow = z
  .object({
    id: Id,
    created_at: Instant,
    region: z.enum(['TR', 'KSA']),
    timezone: z.string().min(1),
    reason: Reason,
    side: Side,
    request_id: Id,
    service: Localized.nullable(),
    status: Status,
    outcome: Outcome.nullable(),
    handled_at: Instant.nullable(),
  })
  .strict();
export type ReportRow = z.infer<typeof ReportRow>;

export const ReportQueue = z
  .object({ rows: z.array(ReportRow), total: z.number().int().nonnegative() })
  .strict();
export type ReportQueue = z.infer<typeof ReportQueue>;

const Party = z
  .object({
    id: Id,
    name: z.string(),
    role: z.enum(['customer', 'provider', 'admin']),
    provider_status: z.string().nullable(),
    is_reporter: z.boolean(),
    filed: z.number().int().nonnegative(),
    against: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  })
  .strict();
export type ReportParty = z.infer<typeof Party>;

export const ReportDetail = z
  .object({
    report: z
      .object({
        id: Id,
        region: z.enum(['TR', 'KSA']),
        request_id: Id,
        reporter_id: Id,
        against_id: Id,
        side: Side,
        reason: Reason,
        text: z.string(),
        status: Status,
        outcome: Outcome.nullable(),
        admin_note: z.string().nullable(),
        handled_by: Id.nullable(),
        handled_at: Instant.nullable(),
        fee_refund_id: Id.nullable(),
        created_at: Instant,
      })
      .strict(),
    parties: z.array(Party),
    photos: z.array(z.object({ id: Id, created_at: Instant }).strict()),
  })
  .strict();
export type ReportDetail = z.infer<typeof ReportDetail>;

export const HandleResult = z
  .object({ status: z.literal('ok'), outcome: Outcome, fee_refund_id: Id.nullable() })
  .strict();

export const PhotoView = z.object({ bucket: z.literal('report-photos'), path: z.string().min(1) }).strict();
