'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { handleReport, reportPhotoLink } from '@/lib/admin-reports';
import { fail, guardedAction } from '@/lib/auth/action';
import { ADMIN_REPORT_DB_CODES, NOTE_MAX, REPORT_OUTCOMES, REPORT_REASONS } from '@/lib/reports/constants';

/**
 * Admin's report actions (spec 0011-14 AC-4, AC-5). Admin only; each database function checks `is_admin()` again.
 * No amount is ever sent: a refund names one of the request's own fee rows (R-11). The note's length is Postgres's
 * to judge (`validation_failed`); the schema only bounds the input.
 */

const ADMIN = ['admin'] as const;
const KNOWN: readonly string[] = ADMIN_REPORT_DB_CODES;

const HandleInput = z
  .object({
    reportId: z.string().uuid(),
    outcome: z.enum(REPORT_OUTCOMES),
    note: z.string().max(NOTE_MAX * 4),
    refundPaymentId: z.string().uuid().nullable(),
    warningReason: z.enum(REPORT_REASONS).nullable(),
  })
  .strict();
const PhotoInput = z.object({ photoId: z.string().uuid() }).strict();

/** AC-5: handle a report once. */
export const handleReportAction = guardedAction(
  { name: 'handleReport', access: ADMIN, schema: HandleInput },
  async (input): Promise<{ outcome: string; refunded: boolean } | ReturnType<typeof fail>> => {
    const outcome = await handleReport(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { outcome: outcome.outcome, refunded: outcome.refunded };
  },
);

/**
 * AC-4, X-3: one photo behind Show. The view is recorded before the link is signed; the link lives 60 seconds and
 * is never logged.
 */
export const reportPhotoLinkAction = guardedAction(
  { name: 'reportPhotoLink', access: ADMIN, schema: PhotoInput },
  async (input): Promise<{ url: string | null } | ReturnType<typeof fail>> => {
    const outcome = await reportPhotoLink(input.photoId);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    return { url: outcome.url };
  },
);
