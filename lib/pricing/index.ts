import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';

import {
  type AnswerError,
  type FormulaError,
  type PricedResult,
  PreviewResult,
  PublishResult,
} from './schemas';

/**
 * Admin's door to the pricing engine (spec 0007, D121). The price is computed in Postgres from the
 * customer's answers: no function here takes a customer's price (rule 1). These wrappers call the admin
 * functions as the signed in user, parse the result, and map each refusal to a stable code. A mapped code
 * reaches no Sentry report; anything else is thrown for `guardedAction` to report.
 *
 * Customers reach the engine only through `lib/requests` (spec 0008): `quote_price` lost its authenticated
 * grant in 04 (AC-28), so `quote_request` and `create_request` call it as their definer owner, behind the
 * quote rate limit. Its alert and log moved there with it.
 */

export type { AnswerError, Breakdown, BreakdownLine, FormulaError, PricedResult } from './schemas';

/** Every code the three functions raise. */
export const PRICING_DB_CODES = [
  'forbidden',
  'service_unavailable',
  'zone_unavailable',
  'addon_unavailable',
  'price_out_of_range',
  'pricing_settings_invalid',
  'stale_formula',
] as const;
export type PricingCode = (typeof PRICING_DB_CODES)[number];

/** A formula as admin builds it: the array order is `apply_order`, and a factor is a string. */
export type DraftModifier = {
  question_key: string | null;
  match_type: 'equals' | 'in' | 'range' | 'is_true' | 'always';
  match_value: unknown;
  effect_type: 'FIXED' | 'PER_UNIT' | 'MULTIPLIER';
  amount: number | null;
  factor: string | null;
};

type Refused = { ok: false; code: PricingCode };

function refusalCode(error: unknown): PricingCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (PRICING_DB_CODES as readonly string[]).includes(message)
    ? (message as PricingCode)
    : null;
}

async function call(fn: string, args: Record<string, unknown>): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const code = refusalCode(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

export type PreviewOutcome =
  | { ok: true; preview: PricedResult }
  | { ok: false; code: 'invalid'; errors: AnswerError[] }
  | { ok: false; code: 'invalid_formula'; errors: FormulaError[] }
  | Refused;

/**
 * Try a draft formula on sample answers (AC-13): the same checks and the same computation as a quote, with
 * off zones and addons allowed and every line shown. Admin only, inside the function. No alert.
 */
export async function previewFormula(input: {
  serviceId: string;
  basePrice: number;
  modifiers: readonly DraftModifier[];
  zoneId: string | null;
  addonIds: readonly string[];
  answers: Record<string, unknown>;
}): Promise<PreviewOutcome> {
  const result = await call('preview_pricing_formula', {
    p_service_id: input.serviceId,
    p_base: input.basePrice,
    p_modifiers: input.modifiers,
    p_zone_id: input.zoneId,
    p_addon_ids: input.addonIds,
    p_answers: input.answers,
  });
  if ('ok' in result) return result;
  const parsed = PreviewResult.parse(result.data);
  if (parsed.status === 'ok') return { ok: true, preview: parsed };
  return parsed.status === 'invalid'
    ? { ok: false, code: 'invalid', errors: parsed.errors }
    : { ok: false, code: 'invalid_formula', errors: parsed.errors };
}

export type PublishOutcome =
  | { ok: true; formulaId: string; version: number }
  | { ok: false; code: 'no_changes' }
  | { ok: false; code: 'invalid_formula'; errors: FormulaError[] }
  | Refused;

/**
 * Publish the next version (AC-12), naming the version the page showed (0 for the first). A second admin
 * who published first makes this `stale_formula`. Admin only, inside the function.
 */
export async function publishFormula(input: {
  serviceId: string;
  expectedVersion: number;
  basePrice: number;
  modifiers: readonly DraftModifier[];
}): Promise<PublishOutcome> {
  const result = await call('publish_pricing_formula', {
    p_service_id: input.serviceId,
    p_expected_version: input.expectedVersion,
    p_base: input.basePrice,
    p_modifiers: input.modifiers,
  });
  if ('ok' in result) return result;
  const parsed = PublishResult.parse(result.data);
  if (parsed.status === 'ok') return { ok: true, formulaId: parsed.formula_id, version: parsed.version };
  return parsed.status === 'no_changes'
    ? { ok: false, code: 'no_changes' }
    : { ok: false, code: 'invalid_formula', errors: parsed.errors };
}
