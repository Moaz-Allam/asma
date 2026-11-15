'use server';

import { revalidatePath } from 'next/cache';

import { fail, guardedAction } from '@/lib/auth/action';
import { PreviewFormulaSchema, PublishFormulaSchema, type DraftModifierInput } from '@/lib/catalog/schemas';
import { parseFactor, parseMinor } from '@/lib/money/parse';
import {
  previewFormula as previewInDb,
  publishFormula as publishInDb,
  type DraftModifier,
  type FormulaError,
} from '@/lib/pricing';

/**
 * Admin's pricing editor (spec 0007 AC-20, AC-21). Amounts arrive as the text admin typed, in major units,
 * and become integer minor units here (`lib/money/parse.ts`); a factor stays the text it was, canonical.
 * A value that does not parse is never guessed: it becomes `modifier_malformed` on its card, as the
 * database would say. Every figure the page shows comes back from the database (rule 1, rule 4).
 */

type Drafted = { basePrice: number; modifiers: DraftModifier[] } | { errors: FormulaError[] };

function draft(basePrice: string, modifiers: readonly DraftModifierInput[]): Drafted {
  const errors: FormulaError[] = [];
  const base = parseMinor(basePrice);
  if (base === null || base < 1) errors.push({ index: null, code: 'base_price_out_of_range' });
  const out: DraftModifier[] = modifiers.map((m, i) => {
    let amount: number | null = null;
    let factor: string | null = null;
    let ok = true;
    if (m.effectType === 'MULTIPLIER') {
      factor = m.factor === null ? null : parseFactor(m.factor, 4);
      ok = factor !== null && m.amount === null;
    } else {
      amount = m.amount === null ? null : parseMinor(m.amount, { allowNegative: m.effectType === 'FIXED' });
      ok = amount !== null && m.factor === null;
    }
    if (!ok) errors.push({ index: i + 1, code: 'modifier_malformed' });
    return {
      question_key: m.questionKey,
      match_type: m.matchType,
      match_value: m.matchValue ?? null,
      effect_type: m.effectType,
      amount,
      factor,
    };
  });
  return errors.length > 0 ? { errors } : { basePrice: base as number, modifiers: out };
}

const KNOWN = ['forbidden', 'service_unavailable', 'zone_unavailable', 'addon_unavailable', 'stale_formula'];

/** Price the draft on sample answers (AC-21). A refusal the panel explains comes back as a code. */
export const previewFormula = guardedAction(
  { name: 'previewFormula', access: ['admin'], schema: PreviewFormulaSchema },
  async (input) => {
    const drafted = draft(input.basePrice, input.modifiers);
    if ('errors' in drafted) return { status: 'invalid_formula' as const, errors: drafted.errors };
    const outcome = await previewInDb({
      serviceId: input.serviceId,
      basePrice: drafted.basePrice,
      modifiers: drafted.modifiers,
      zoneId: input.zoneId,
      addonIds: input.addonIds,
      answers: input.answers,
    });
    if (outcome.ok) return { status: 'ok' as const, preview: outcome.preview };
    if (outcome.code === 'invalid') return { status: 'invalid' as const, errors: outcome.errors };
    if (outcome.code === 'invalid_formula')
      return { status: 'invalid_formula' as const, errors: outcome.errors };
    if (outcome.code === 'price_out_of_range' || outcome.code === 'pricing_settings_invalid') {
      return { status: outcome.code };
    }
    return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
  },
);

/** Publish the next version (AC-12, AC-20), naming the version the page rendered. */
export const publishFormula = guardedAction(
  { name: 'publishFormula', access: ['admin'], schema: PublishFormulaSchema },
  async (input) => {
    const drafted = draft(input.basePrice, input.modifiers);
    if ('errors' in drafted) return { status: 'invalid_formula' as const, errors: drafted.errors };
    const outcome = await publishInDb({
      serviceId: input.serviceId,
      expectedVersion: input.expectedVersion,
      basePrice: drafted.basePrice,
      modifiers: drafted.modifiers,
    });
    if (outcome.ok) {
      revalidatePath('/', 'layout');
      return { status: 'ok' as const, version: outcome.version };
    }
    if (outcome.code === 'no_changes') return { status: 'no_changes' as const };
    if (outcome.code === 'invalid_formula')
      return { status: 'invalid_formula' as const, errors: outcome.errors };
    return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
  },
);
