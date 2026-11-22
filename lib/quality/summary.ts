import { z } from 'zod';

import { NUMBER_LOCALE } from '@/lib/requests/view';

/**
 * What every quality surface shares (spec 0011-19a): the shapes Postgres returns (the card's three figures, AC-3;
 * every figure with its counts, AC-2; probation, AC-4; the watchlist kinds and their stored figures, AC-8), and the
 * one way a percentage, a window and a flag's figure are worded. No `server-only`: Client Components read the types
 * and the formatters. Nothing here computes a figure; Postgres does, every time it is read.
 */

const Count = z.number().int().nonnegative();
const Pct = z.number().int().min(0).max(100);

/** A rate on the card: only from `metrics_min_jobs` in its own denominator (AC-3). */
export const CardRate = z.object({ pct: Pct, den: z.number().int().min(1) }).strict();
export type CardRate = z.infer<typeof CardRate>;

/** AC-3: jobs done on Aldebyani, and the two rates customers see, with the window and the grace they count over. */
export const CardQuality = z
  .object({
    jobs_done: Count,
    completion: CardRate.nullable(),
    on_time: CardRate.nullable(),
    window_days: z.number().int().min(30).max(1095),
    grace_minutes: z.number().int().min(0).max(120),
  })
  .strict();
export type CardQuality = z.infer<typeof CardQuality>;

/** AC-2: a rate with its counts; `pct` is null with nothing counted. */
export const Rate = z.object({ num: Count, den: Count, pct: Pct.nullable() }).strict();
export type Rate = z.infer<typeof Rate>;

/** AC-2, AC-13: every figure of one provider, computed when read. Admin only. */
export const ProviderMetrics = z
  .object({
    jobs_done: Count,
    completion: Rate,
    on_time: Rate,
    cancellation: Rate,
    reports: Rate,
    repeat_customers: Rate,
    response_minutes: z
      .object({ minutes: Count, count: z.number().int().min(1) })
      .strict()
      .nullable(),
    follow_through: Rate,
    window_days: z.number().int().min(30).max(1095),
    grace_minutes: z.number().int().min(0).max(120),
  })
  .strict();
export type ProviderMetrics = z.infer<typeof ProviderMetrics>;

/** The seven rates in the order the admin page lists them (AC-13). */
export const METRIC_RATES = [
  'completion',
  'on_time',
  'cancellation',
  'reports',
  'repeat_customers',
  'follow_through',
] as const;
export type MetricRate = (typeof METRIC_RATES)[number];

/** AC-4, AC-11, AC-13: probation progress and the live job limit, set only while on probation. */
export const Probation = z
  .object({
    jobs_done: Count,
    jobs_needed: z.number().int().min(1),
    live: Count,
    live_limit: z.number().int().min(1),
  })
  .strict();
export type Probation = z.infer<typeof Probation>;

/** AC-4: `my_provider_quality()`. The card is null when a quality setting is broken. */
export const MyQuality = z
  .object({ quality: CardQuality.nullable(), probation: Probation.nullable() })
  .strict();
export type MyQuality = z.infer<typeof MyQuality>;

/** AC-8: the watchlist kinds. The first four are rates; the last two name one report or one cancel each. */
export const FLAG_KINDS = [
  'low_rating',
  'high_reports',
  'high_cancellations',
  'low_follow_through',
  'probation_report',
  'probation_cancel',
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export const FLAG_OUTCOMES = ['warned', 'suspended', 'cleared'] as const;
export type FlagOutcome = (typeof FLAG_OUTCOMES)[number];

/** AC-8: what crossed, stored at raise time. */
export const RateFigure = z.object({ num: Count, den: Count, pct: Pct.nullable(), threshold: Pct }).strict();
export const RatingFigure = z
  .object({
    overall: z.number().min(1).max(5),
    count: z.number().int().min(1),
    threshold: z.number().min(1).max(5),
  })
  .strict();
export const SourceFigure = z.object({ source: z.enum(['report', 'request']) }).strict();
export const FlagFigure = z.union([RateFigure, RatingFigure, SourceFigure]);
export type FlagFigure = z.infer<typeof FlagFigure>;

/** A whole percentage in the locale's number format: `92%`, `%92`, Western digits in Arabic too (i18n §7). */
export function formatPercent(pct: number, locale: string): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale] ?? locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(pct / 100);
}

/** A count in the locale's number format. */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[locale] ?? locale).format(value);
}

/**
 * AC-3, X-19: the window the card's rates count over, in months when it is whole months (a multiple of 30 days) or
 * whole years (365 reads 12 months), else in days.
 */
export function windowSpan(days: number): { unit: 'months' | 'days'; count: number } {
  if (days % 365 === 0) return { unit: 'months', count: (days / 365) * 12 };
  if (days % 30 === 0) return { unit: 'months', count: days / 30 };
  return { unit: 'days', count: days };
}

/**
 * A flag's figure as the key and values its sentence needs (AC-10): "Cancellation rate 3 of 12 jobs (25%), limit
 * 10%". The rating's score keeps one decimal, as customers see it. Display only.
 */
export function flagFigure(
  kind: FlagKind,
  figure: FlagFigure,
  locale: string,
): { key: string; values: Record<string, string> } {
  const tag = NUMBER_LOCALE[locale] ?? locale;
  const decimal = (value: number) =>
    new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  if ('source' in figure) return { key: `figure.${figure.source}`, values: {} };
  if ('overall' in figure) {
    return {
      key: 'figure.rating',
      values: {
        overall: decimal(figure.overall),
        count: formatCount(figure.count, locale),
        limit: decimal(figure.threshold),
      },
    };
  }
  return {
    key: `figure.${kind}`,
    values: {
      num: formatCount(figure.num, locale),
      den: formatCount(figure.den, locale),
      pct: figure.pct === null ? '' : formatPercent(figure.pct, locale),
      limit: formatPercent(figure.threshold, locale),
    },
  };
}
