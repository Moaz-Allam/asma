/**
 * The fixed lists of the catalog and the pricing editor (spec 0007, Question types and Match table). Plain
 * data, safe in the browser: the pages offer only what the database accepts, and the database checks again.
 */

export const QUESTION_TYPES = [
  'number',
  'single_select',
  'multi_select',
  'boolean',
  'text',
  'textarea',
  'date',
  'time',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Types that may affect the price. Text, dates and times never change it (§20). */
export const PRICED_TYPES: readonly QuestionType[] = ['number', 'single_select', 'multi_select', 'boolean'];
export const SELECT_TYPES: readonly QuestionType[] = ['single_select', 'multi_select'];
export const TEXT_TYPES: readonly QuestionType[] = ['text', 'textarea'];

export const MATCH_TYPES = ['always', 'equals', 'in', 'range', 'is_true'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];
export const EFFECT_TYPES = ['FIXED', 'PER_UNIT', 'MULTIPLIER'] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

/** What a modifier on each question type may match and do. `none` is a modifier with no question. */
export const MATCH_TABLE: Readonly<
  Record<
    'number' | 'single_select' | 'multi_select' | 'boolean' | 'none',
    Readonly<Record<string, readonly EffectType[]>>
  >
> = {
  number: {
    always: ['FIXED', 'PER_UNIT', 'MULTIPLIER'],
    equals: ['FIXED', 'PER_UNIT', 'MULTIPLIER'],
    range: ['FIXED', 'PER_UNIT', 'MULTIPLIER'],
  },
  single_select: { equals: ['FIXED', 'MULTIPLIER'], in: ['FIXED', 'MULTIPLIER'] },
  multi_select: { equals: ['FIXED'], in: ['FIXED'] },
  boolean: { is_true: ['FIXED', 'MULTIPLIER'] },
  none: { always: ['FIXED', 'MULTIPLIER'] },
};

export function matchesFor(type: QuestionType | null): MatchType[] {
  const row = MATCH_TABLE[type === null ? 'none' : (type as keyof typeof MATCH_TABLE)];
  return row ? (Object.keys(row) as MatchType[]) : [];
}

export function effectsFor(type: QuestionType | null, match: MatchType): EffectType[] {
  const row = MATCH_TABLE[type === null ? 'none' : (type as keyof typeof MATCH_TABLE)];
  return row?.[match] ? [...row[match]] : [];
}

/** The five catalog tables, as the two row actions name them. */
export const CATALOG_TABLES = ['service_categories', 'services', 'addons', 'zones', 'questions'] as const;
export type CatalogTable = (typeof CATALOG_TABLES)[number];

export const CATALOG_TABS = ['questions', 'services', 'addons', 'zones'] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

/** The limits the database holds, repeated so a form can say them. */
export const CATALOG_LIMITS = {
  name: 120,
  helpText: 300,
  options: 30,
  optionValue: 40,
  key: 40,
  numberMax: 10000,
  textMax: 500,
  textareaMax: 2000,
  textDefault: 200,
  textareaDefault: 500,
  hoursMin: 1,
  hoursMax: 24,
  modifiers: 50,
} as const;

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const OPTION_VALUE_PATTERN = /^[a-z0-9_]{1,40}$/;
