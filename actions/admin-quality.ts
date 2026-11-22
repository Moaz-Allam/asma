'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ADMIN_QUALITY_DB_CODES, endProbation, handleQualityFlag } from '@/lib/admin-quality';
import { REASON_MAX } from '@/lib/admin-requests/constants';
import { fail, guardedAction } from '@/lib/auth/action';
import { FLAG_OUTCOMES } from '@/lib/quality/summary';

/**
 * Admin's quality actions (spec 0011-19a AC-5, AC-9). Admin only; each definer function checks `is_admin()` again.
 * No figure is ever sent: a handle names the flag, the outcome and a note; ending probation names the provider and a
 * note. The note's length is Postgres's to judge (`reason_required`); the schema only bounds the input.
 */

const ADMIN = ['admin'] as const;
const KNOWN: readonly string[] = ADMIN_QUALITY_DB_CODES;

const HandleInput = z
  .object({ flagId: z.string().uuid(), outcome: z.enum(FLAG_OUTCOMES), note: z.string().max(REASON_MAX * 4) })
  .strict();

const EndInput = z.object({ providerId: z.string().uuid(), note: z.string().max(REASON_MAX * 4) }).strict();

/** AC-9: warn, suspend or clear one open flag, once. */
export const handleQualityFlagAction = guardedAction(
  { name: 'handleQualityFlag', access: ADMIN, schema: HandleInput },
  async (input) => {
    const outcome = await handleQualityFlag(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { outcome: outcome.outcome };
  },
);

/** AC-5: end one provider's probation, once (a waiver is final). */
export const endProbationAction = guardedAction(
  { name: 'endProbation', access: ADMIN, schema: EndInput },
  async (input) => {
    const outcome = await endProbation(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { status: 'ok' as const };
  },
);
