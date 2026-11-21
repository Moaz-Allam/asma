'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ADMIN_RATING_DB_CODES, hideRating } from '@/lib/admin-ratings';
import { fail, guardedAction } from '@/lib/auth/action';
import { HIDE_NOTE_MAX, HIDE_REASONS } from '@/lib/ratings/summary';

/**
 * Admin's rating action (spec 0011-17 AC-8). Admin only; `admin_hide_rating` checks `is_admin()` again. No score is
 * ever sent or changed: a hide names the rating, a reason and a note. The note's length is Postgres's to judge
 * (`validation_failed`); the schema only bounds the input.
 */

const ADMIN = ['admin'] as const;
const KNOWN: readonly string[] = ADMIN_RATING_DB_CODES;

const HideInput = z
  .object({
    ratingId: z.string().uuid(),
    reason: z.enum(HIDE_REASONS),
    note: z.string().max(HIDE_NOTE_MAX * 4),
  })
  .strict();

/** Hide one rating, once (a hide is final). */
export const hideRatingAction = guardedAction(
  { name: 'hideRating', access: ADMIN, schema: HideInput },
  async (input): Promise<{ hiddenAt: string } | ReturnType<typeof fail>> => {
    const outcome = await hideRating(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { hiddenAt: outcome.hiddenAt };
  },
);
