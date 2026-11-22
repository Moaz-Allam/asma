import 'server-only';

import { z } from 'zod';

import { REPORT_REASONS, WARNING_REASONS } from './constants';

/** What the report functions return (spec 0011-14 AC-1, AC-2, AC-6, AC-7). Strict: an unplanned key fails the parse. */

const Id = z.string().uuid();
const Instant = z.string().min(1);

export const OpenReportResult = z.object({ status: z.literal('ok'), report_id: Id }).strict();

export const AddPhotoResult = z
  .object({ status: z.literal('ok'), photo_id: Id, replayed: z.boolean() })
  .strict();

/** AC-7: the caller's own latest report on a request, never the outcome, the note or the text. */
export const MyReport = z
  .object({
    can_report: z.boolean(),
    side: z.enum(['customer', 'provider']),
    // The request's own region (rule 10): the photo path is built from it.
    region: z.enum(['TR', 'KSA']),
    report: z
      .object({
        id: Id,
        status: z.enum(['open', 'handled']),
        reason: z.enum(REPORT_REASONS),
        created_at: Instant,
        handled_at: Instant.nullable(),
        photos: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MyReport = z.infer<typeof MyReport>;

/** AC-6: the oldest warning not acknowledged yet. Spec 0011-19a X-13: a report reason or a quality reason. */
export const MyWarning = z
  .object({ id: Id, reason: z.enum(WARNING_REASONS), created_at: Instant })
  .strict()
  .nullable();
export type MyWarning = z.infer<typeof MyWarning>;

export const AckResult = z.object({ status: z.literal('ok'), replayed: z.boolean() }).strict();
