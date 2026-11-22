import { z } from 'zod';

import { FLAG_KINDS, FLAG_OUTCOMES, FlagFigure, Probation, ProviderMetrics } from '@/lib/quality/summary';

/**
 * The replies of admin's quality functions (spec 0011-19a AC-9 to AC-13), parsed strictly: a key the functions must
 * never send fails the parse. No server-only, so the unit tests read them.
 */

const Uuid = z.string().uuid();
const Count = z.number().int().nonnegative();
const Standing = z.enum(['draft', 'pending', 'approved', 'rejected', 'suspended', 'document_expired']);

/** AC-10: one open flag. */
export const QualityFlagRow = z
  .object({
    id: Uuid,
    kind: z.enum(FLAG_KINDS),
    figure: FlagFigure,
    raised_at: z.string().min(1),
    provider_id: Uuid,
    provider_name: z.string().nullable(),
    standing: Standing.nullable(),
    region: z.string().min(1),
    timezone: z.string().min(1),
  })
  .strict();
export type QualityFlagRow = z.infer<typeof QualityFlagRow>;

export const QualityFlagsPage = z.object({ rows: z.array(QualityFlagRow), total: Count }).strict();
export type QualityFlagsPage = z.infer<typeof QualityFlagsPage>;

/** AC-11: one provider on probation. */
export const ProbationRow = z
  .object({
    provider_id: Uuid,
    provider_name: z.string().nullable(),
    region: z.string().min(1),
    timezone: z.string().min(1),
    approved_at: z.string().nullable(),
    jobs_done: Count,
    jobs_needed: z.number().int().min(1),
    live: Count,
    live_limit: z.number().int().min(1),
    reports: Count,
    open_flags: Count,
  })
  .strict();
export type ProbationRow = z.infer<typeof ProbationRow>;

export const ProbationPage = z.object({ rows: z.array(ProbationRow), total: Count }).strict();
export type ProbationPage = z.infer<typeof ProbationPage>;

export const FUNNEL_STAGES = [
  'draft',
  'pending',
  'probation',
  'active',
  'document_expired',
  'rejected',
  'suspended',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** AC-12: a region's stages now and its first decisions of the last 12 months, newest first. */
export const FunnelRegion = z
  .object({
    region: z.string().min(1),
    timezone: z.string().min(1),
    stages: z
      .object(Object.fromEntries(FUNNEL_STAGES.map((s) => [s, Count])) as Record<FunnelStage, typeof Count>)
      .strict(),
    months: z.array(
      z
        .object({
          month: z.string().regex(/^\d{4}-\d{2}$/),
          approved: Count,
          rejected: Count,
          rate: z.number().min(0).max(100).nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type FunnelRegion = z.infer<typeof FunnelRegion>;

export const Funnel = z.array(FunnelRegion);

/** AC-13: every figure of one provider, probation, the waiver and the last 20 flags. */
export const AdminProviderQuality = z
  .object({
    timezone: z.string().min(1),
    metrics: ProviderMetrics,
    probation: Probation.nullable(),
    waiver: z
      .object({ note: z.string(), by_name: z.string().nullable(), at: z.string().min(1) })
      .strict()
      .nullable(),
    flags: z.array(
      z
        .object({
          id: Uuid,
          kind: z.enum(FLAG_KINDS),
          figure: FlagFigure,
          raised_at: z.string().min(1),
          outcome: z.enum(FLAG_OUTCOMES).nullable(),
          note: z.string().nullable(),
          handled_by_name: z.string().nullable(),
          handled_at: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type AdminProviderQuality = z.infer<typeof AdminProviderQuality>;

export const HandleFlagResult = z
  .object({ status: z.literal('ok'), outcome: z.enum(FLAG_OUTCOMES) })
  .strict();
export const EndProbationResult = z.object({ status: z.literal('ok') }).strict();
