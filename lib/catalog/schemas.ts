import 'server-only';

import { z } from 'zod';

import { IdSchema } from '@/lib/validation';

import {
  CATALOG_LIMITS,
  CATALOG_TABLES,
  EFFECT_TYPES,
  KEY_PATTERN,
  MATCH_TYPES,
  QUESTION_TYPES,
} from './options';

/**
 * What the catalog and pricing actions accept (spec 0007, API surface). Shape only: the database checks
 * every rule again, and its refusal maps to a code. Money arrives as the text admin typed and is parsed in
 * the action (`lib/money/parse.ts`), never here.
 */

const Id = IdSchema;

/** A localised field. Blank locales are dropped, so `{ tr: 'Temizlik', en: '' }` stores `{ tr: 'Temizlik' }`. */
function localizedText(max: number) {
  return z
    .object({ ar: z.string().optional(), tr: z.string().optional(), en: z.string().optional() })
    .strict()
    .transform((value) => {
      const out: Record<string, string> = {};
      for (const [locale, text] of Object.entries(value)) {
        const trimmed = (text ?? '').trim();
        if (trimmed !== '') out[locale] = trimmed;
      }
      return out;
    })
    .refine((value) => Object.values(value).every((text) => [...text].length <= max));
}

const Name = localizedText(CATALOG_LIMITS.name);
const OptionalText = (max: number) =>
  localizedText(max)
    .nullable()
    .transform((value) => (value && Object.keys(value).length > 0 ? value : null));

export const SaveCategorySchema = z.object({ id: Id.optional(), name: Name });

export const SaveServiceSchema = z
  .object({
    id: Id.optional(),
    categoryId: Id,
    name: Name,
    note: OptionalText(CATALOG_LIMITS.name),
    hoursMin: z.number().int().min(CATALOG_LIMITS.hoursMin).max(CATALOG_LIMITS.hoursMax),
    hoursMax: z.number().int().min(CATALOG_LIMITS.hoursMin).max(CATALOG_LIMITS.hoursMax),
  })
  .refine((value) => value.hoursMin <= value.hoursMax);

export const SaveAddonSchema = z.object({
  id: Id.optional(),
  serviceId: Id,
  name: Name,
  price: z.string().max(20),
});

export const SaveZoneSchema = z.object({ id: Id.optional(), name: Name, multiplier: z.string().max(10) });

const OptionSchema = z.object({ value: z.string(), label: Name }).strict();

export const SaveQuestionSchema = z.object({
  id: Id.optional(),
  categoryId: Id,
  serviceId: Id.nullable(),
  key: z.string().regex(KEY_PATTERN),
  type: z.enum(QUESTION_TYPES),
  label: Name,
  helpText: OptionalText(CATALOG_LIMITS.helpText),
  required: z.boolean(),
  affectsPricing: z.boolean(),
  options: z.array(OptionSchema).max(CATALOG_LIMITS.options).nullable(),
  validation: z
    .union([
      z.object({ min: z.number().int(), max: z.number().int(), step: z.number().int() }).strict(),
      z.object({ maxLength: z.number().int() }).strict(),
    ])
    .nullable(),
});

export const SetActiveSchema = z.object({ table: z.enum(CATALOG_TABLES), id: Id, active: z.boolean() });

export const MoveRowSchema = z.object({
  table: z.enum(CATALOG_TABLES),
  id: Id,
  direction: z.enum(['up', 'down']),
});

/** A modifier as the editor sends it: the amount in major units and the factor as typed. */
export const DraftModifierInput = z
  .object({
    questionKey: z.string().max(CATALOG_LIMITS.key).nullable(),
    matchType: z.enum(MATCH_TYPES),
    matchValue: z.unknown(),
    effectType: z.enum(EFFECT_TYPES),
    amount: z.string().max(20).nullable(),
    factor: z.string().max(20).nullable(),
  })
  .strict();
export type DraftModifierInput = z.infer<typeof DraftModifierInput>;

const Modifiers = z.array(DraftModifierInput).max(CATALOG_LIMITS.modifiers + 1);

export const PreviewFormulaSchema = z.object({
  serviceId: Id,
  basePrice: z.string().max(20),
  modifiers: Modifiers,
  zoneId: Id.nullable(),
  addonIds: z.array(Id).max(50),
  answers: z.record(z.string().max(CATALOG_LIMITS.key), z.unknown()),
});

export const PublishFormulaSchema = z.object({
  serviceId: Id,
  expectedVersion: z.number().int().min(0),
  basePrice: z.string().max(20),
  modifiers: Modifiers,
});
