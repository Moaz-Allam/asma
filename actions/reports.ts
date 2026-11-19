'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { fail, guardedAction } from '@/lib/auth/action';
import { acknowledgeWarning, addReportPhoto, openReport } from '@/lib/reports';
import { REPORT_DB_CODES, REPORT_REASONS, REPORT_TEXT_MAX_BYTES } from '@/lib/reports/constants';

/**
 * The parties' report actions (spec 0011-14 AC-1, AC-2, AC-6). A customer or a provider; each database function
 * checks again who is a party, the window and the limits (R-1 to R-4). The text's length is Postgres's to judge
 * (`validation_failed`); the schema only bounds the input. A refusal comes back as its stable code.
 */

const PARTIES = ['customer', 'provider'] as const;
const KNOWN: readonly string[] = REPORT_DB_CODES;

const OpenInput = z
  .object({
    requestId: z.string().uuid(),
    reason: z.enum(REPORT_REASONS),
    text: z.string().max(REPORT_TEXT_MAX_BYTES),
  })
  .strict();
// X-5: the path shape is checked again by the database against the report's own region and id.
const PhotoInput = z
  .object({
    reportId: z.string().uuid(),
    path: z.string().regex(/^[A-Z]{2,3}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/),
  })
  .strict();
const AckInput = z.object({ warningId: z.string().uuid() }).strict();

/** AC-1: open a report; the photos follow, one by one (X-25). */
export const openReportAction = guardedAction(
  { name: 'openReport', access: PARTIES, schema: OpenInput },
  async (input): Promise<{ reportId: string } | ReturnType<typeof fail>> => {
    const outcome = await openReport(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { reportId: outcome.reportId };
  },
);

/** AC-2: register one uploaded photo. A replay is ok. */
export const addReportPhotoAction = guardedAction(
  { name: 'addReportPhoto', access: PARTIES, schema: PhotoInput },
  async (input): Promise<{ replayed: boolean } | ReturnType<typeof fail>> => {
    const outcome = await addReportPhoto(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    return { replayed: outcome.replayed };
  },
);

/** AC-6: acknowledge the caller's own warning; the banner goes. */
export const acknowledgeWarningAction = guardedAction(
  { name: 'acknowledgeWarning', access: PARTIES, schema: AckInput },
  async (input): Promise<{ replayed: boolean } | ReturnType<typeof fail>> => {
    const outcome = await acknowledgeWarning(input.warningId);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { replayed: outcome.replayed };
  },
);
