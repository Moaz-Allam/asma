import type { ComparableModifier } from '@/lib/catalog/compare';
import type { EffectType, MatchType, QuestionType } from '@/lib/catalog/options';

/**
 * What the pricing page hands its Client Components (spec 0007 AC-20, AC-21). Text is in the page's locale
 * already; money is integer minor units for display, and form text made on the server for the fields.
 */

export type PricingQuestion = {
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options: { value: string; label: string }[] | null;
  validation: { min?: number; max?: number; step?: number } | null;
};

export type PricingAddon = { id: string; name: string; price: number; active: boolean };
export type PricingZone = { id: string; name: string; multiplier: string; active: boolean };

/** A modifier in the editor: the amount in major units and the factor as typed. */
export type EditorModifier = ComparableModifier & {
  /** A local id for React keys and focus, never sent. */
  uid: string;
  matchType: MatchType;
  effectType: EffectType;
};
