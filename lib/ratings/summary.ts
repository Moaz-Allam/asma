import { z } from 'zod';

import { NUMBER_LOCALE } from '@/lib/requests/view';

/**
 * What every rating surface shares (spec 0011-17): the four dimensions, the hide reasons, the summary shape that
 * `provider_rating_summary` returns (AC-4), and the one way a figure is written. No `server-only`: Client Components
 * read the types and the formatter. Nothing here computes a score; Postgres does, every time it is read.
 */

export const RATING_DIMENSIONS = ['punctuality', 'quality', 'professionalism', 'value'] as const;
export type RatingDimension = (typeof RATING_DIMENSIONS)[number];

export const RATING_SCORES = [1, 2, 3, 4, 5] as const;
export type RatingScore = (typeof RATING_SCORES)[number];

export const HIDE_REASONS = ['fake', 'pressure', 'customer_asked', 'other'] as const;
export type HideReason = (typeof HIDE_REASONS)[number];
export const HIDE_NOTE_MAX = 500;

const Figure = z.number().min(1).max(5);
const Score = z.number().int().min(1).max(5);

/** AC-4: New below the minimum count, a score from 5 ratings on, or nothing when a setting is broken. */
export const RatingSummary = z.discriminatedUnion('state', [
  z.object({ state: z.literal('new'), count: z.number().int().nonnegative() }).strict(),
  z
    .object({
      state: z.literal('rated'),
      count: z.number().int().min(5),
      overall: Figure,
      punctuality: Figure,
      quality: Figure,
      professionalism: Figure,
      value: Figure,
    })
    .strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
]);
export type RatingSummary = z.infer<typeof RatingSummary>;
export type RatedSummary = Extract<RatingSummary, { state: 'rated' }>;

/** One rating's four scores (AC-6, AC-8). */
export const RatingScores = z
  .object({ punctuality: Score, quality: Score, professionalism: Score, value: Score })
  .strict();
export type RatingScores = z.infer<typeof RatingScores>;

/** A figure with one decimal, Western digits in every locale (i18n §7): `4.8`, `٤٫٨` never. */
export function formatScore(value: number, locale: string): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale] ?? locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** A bar's width as a CSS percentage: display only, the figure over 5. */
export function barPercent(value: number): string {
  return `${Math.max(0, Math.min(100, (value / 5) * 100))}%`;
}
