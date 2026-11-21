import 'server-only';

import { z } from 'zod';

import { HIDE_REASONS, RatingSummary } from '@/lib/ratings/summary';

/**
 * What the admin rating functions return (spec 0011-17 AC-8). Strict at every level, so a key a function starts
 * sending by mistake fails the parse instead of reaching the page.
 */

const Id = z.string().uuid();
const Instant = z.string().min(1);
const Score = z.number().int().min(1).max(5);

export const AdminRatingRow = z
  .object({
    id: Id,
    created_at: Instant,
    request_id: Id,
    punctuality: Score,
    quality: Score,
    professionalism: Score,
    value: Score,
    hide: z
      .object({
        reason: z.enum(HIDE_REASONS),
        note: z.string(),
        hidden_by_name: z.string().nullable(),
        hidden_at: Instant,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type AdminRatingRow = z.infer<typeof AdminRatingRow>;

export const AdminProviderRatings = z
  .object({
    summary: RatingSummary,
    total: z.number().int().nonnegative(),
    timezone: z.string().min(1),
    rows: z.array(AdminRatingRow),
  })
  .strict();
export type AdminProviderRatings = z.infer<typeof AdminProviderRatings>;

export const HideResult = z.object({ hidden_at: Instant }).strict();
