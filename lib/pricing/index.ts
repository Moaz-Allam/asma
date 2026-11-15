import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import { raiseAlert } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import type { Region } from '@/lib/region';

import {
  type AnswerError,
  type FormulaError,
  type PricedResult,
  PreviewResult,
  PublishResult,
  QuoteResult,
} from './schemas';

/**
 * The app's one door to the pricing engine (spec 0007, D121). The price is computed in Postgres, by
 * `quote_price`, from the customer's answers: no function here takes a price, and the browser never sends
 * one (rule 1). These wrappers call the three functions as the signed in user, parse the result, and map
 * each refusal to a stable code. A mapped code reaches no Sentry report; anything else is thrown for
 * `guardedAction` to report.
 *
 * Position 04's `create_request` calls `quote_price` inside its own transaction, so the stored price never
 * passes through here (and raises its own alert at submit).
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

export type QuoteOutcome =
  { ok: true; quote: PricedResult } | { ok: false; code: 'invalid'; errors: AnswerError[] } | Refused;

/**
 * Quote a service for the signed in caller (AC-9). The region is the caller's, read inside the function;
 * `context` names it for the alert and the log only. `pricing_settings_invalid` raises an alert, because
 * every quote in that region now refuses; `price_out_of_range` only logs, because a customer's own answers
 * can reach it. Either way the caller shows a plain "this service cannot be priced right now".
 */
export async function quotePrice(
  input: { serviceId: string; zoneId: string; addonIds: readonly string[]; answers: Record<string, unknown> },
  context: { region: Region; userId: string },
): Promise<QuoteOutcome> {
  const result = await call('quote_price', {
    p_service_id: input.serviceId,
    p_zone_id: input.zoneId,
    p_addon_ids: input.addonIds,
    p_answers: input.answers,
  });
  if ('ok' in result) {
    if (result.code === 'pricing_settings_invalid') {
      raiseAlert('pricing_settings_invalid', { recordId: input.serviceId, region: context.region });
    } else if (result.code === 'price_out_of_range') {
      log.warn('price_out_of_range', { region: context.region, user_id: context.userId });
    }
    return result;
  }
  const parsed = QuoteResult.parse(result.data);
  return parsed.status === 'ok'
    ? { ok: true, quote: parsed }
    : { ok: false, code: 'invalid', errors: parsed.errors };
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
