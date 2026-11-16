import 'server-only';

import { z } from 'zod';

/**
 * The shapes the three pricing functions return (spec 0007, Output shape). Parsed on the server, so a
 * change in the database surfaces as an error here, never as a wrong figure on a page. Amounts are integer
 * minor units; the factor, the zone multiplier and the unrounded subtotal stay strings, as `numeric` sent them.
 */

const Localized = z.record(z.string(), z.string());
const Minor = z.number().int();

export const BreakdownLine = z.object({
  question_key: z.string().nullable(),
  match_type: z.enum(['equals', 'in', 'range', 'is_true', 'always']),
  match_value: z.unknown(),
  effect_type: z.enum(['FIXED', 'PER_UNIT', 'MULTIPLIER']),
  amount: Minor.nullable(),
  factor: z.string().nullable(),
  units: z.number().int().nullable(),
  fired: z.boolean(),
});
export type BreakdownLine = z.infer<typeof BreakdownLine>;

export const Breakdown = z.object({
  base: Minor,
  modifiers: z.array(BreakdownLine),
  addons: z.array(z.object({ id: z.string(), name: Localized, price: Minor })),
  zone: z.object({ id: z.string(), name: Localized, multiplier: z.string() }).nullable(),
  unrounded: z.string(),
  rounding_minor: Minor,
});
export type Breakdown = z.infer<typeof Breakdown>;

export const PricedResult = z.object({
  status: z.literal('ok'),
  price: Minor.positive(),
  currency: z.enum(['TRY', 'SAR']),
  formula_id: z.string().nullable(),
  formula_version: z.number().int().nullable(),
  breakdown: Breakdown,
});
export type PricedResult = z.infer<typeof PricedResult>;

export const AnswerErrors = z.object({
  status: z.literal('invalid'),
  errors: z.array(z.object({ key: z.string().nullable(), code: z.string() })),
});
export type AnswerError = z.infer<typeof AnswerErrors>['errors'][number];

export const FormulaErrors = z.object({
  status: z.literal('invalid_formula'),
  errors: z.array(z.object({ index: z.number().int().nullable(), code: z.string() })),
});
export type FormulaError = z.infer<typeof FormulaErrors>['errors'][number];

export const PreviewResult = z.discriminatedUnion('status', [PricedResult, AnswerErrors, FormulaErrors]);
export const PublishResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), formula_id: z.string(), version: z.number().int().positive() }),
  z.object({ status: z.literal('no_changes') }),
  FormulaErrors,
]);
