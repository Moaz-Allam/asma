import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import { getPublicRegions } from '@/lib/region/public';
import { isRegion, REGION_CONFIG, type Region } from '@/lib/region';

import type { QuestionType } from './options';

/**
 * Admin's reads for `/admin/catalog` and `/admin/pricing` (spec 0007, Value sourcing), as the signed in
 * admin, under RLS: a non admin reads no row of these tables. Text stays localised JSON here; the page
 * picks one locale with `localized()` before anything reaches a Client Component.
 */

/** The region the pages work in: the first active one. No switch while one region is live (D117). */
export async function adminRegion(): Promise<{ region: Region; defaultLocale: string } | null> {
  const regions = await getPublicRegions();
  const code = regions[0]?.code;
  if (!isRegion(code)) return null;
  return { region: code, defaultLocale: REGION_CONFIG[code].defaultLocale };
}

export type CategoryRow = {
  id: string;
  name: unknown;
  active: boolean;
  services: number;
  questions: number;
};

export type ServiceRow = {
  id: string;
  categoryId: string;
  name: unknown;
  note: unknown;
  hoursMin: number;
  hoursMax: number;
  active: boolean;
  hasFormula: boolean;
};

export type AddonRow = { id: string; serviceId: string; name: unknown; price: number; active: boolean };
export type ZoneRow = { id: string; name: unknown; multiplier: string; active: boolean };

export type QuestionRow = {
  id: string;
  categoryId: string;
  serviceId: string | null;
  key: string;
  type: QuestionType;
  label: unknown;
  helpText: unknown;
  required: boolean;
  affectsPricing: boolean;
  options: { value: string; label: unknown }[] | null;
  validation: { min?: number; max?: number; step?: number; maxLength?: number } | null;
  active: boolean;
};

type Count = { count: number }[] | null;

function count(value: Count): number {
  return value?.[0]?.count ?? 0;
}

/** A `numeric(3,2)` as PostgREST sends it (a JSON number) to its two decimal text: 1 is `1.00`. */
export function twoDecimals(value: unknown): string {
  const [whole, frac = ''] = String(value).split('.');
  return `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

function fail(error: unknown): never {
  throw error;
}

export async function listCategories(region: Region): Promise<CategoryRow[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('service_categories')
    .select('id, name, active, services(count), questions(count)')
    .eq('region', region)
    .order('display_order')
    .order('id');
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    services: count(row.services as Count),
    questions: count(row.questions as Count),
  }));
}

export async function listZones(region: Region): Promise<ZoneRow[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('zones')
    .select('id, name, multiplier, active')
    .eq('region', region)
    .order('display_order')
    .order('id');
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    multiplier: twoDecimals(row.multiplier),
    active: row.active,
  }));
}

/** The services of one category, or of the whole region, with whether each has an active formula. */
export async function listServices(region: Region, categoryId: string | null): Promise<ServiceRow[]> {
  const supabase = await createSupabaseServer();
  let query = supabase
    .from('services')
    .select('id, category_id, name, note, hours_min, hours_max, active, pricing_formulas(id)')
    .eq('region', region)
    .eq('pricing_formulas.active', true)
    .order('display_order')
    .order('id');
  if (categoryId) query = query.eq('category_id', categoryId);
  const { data, error } = await query;
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    note: row.note,
    hoursMin: row.hours_min,
    hoursMax: row.hours_max,
    active: row.active,
    hasFormula: ((row.pricing_formulas as unknown[] | null) ?? []).length > 0,
  }));
}

export async function listAddons(serviceIds: readonly string[]): Promise<AddonRow[]> {
  if (serviceIds.length === 0) return [];
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('addons')
    .select('id, service_id, name, price, active')
    .in('service_id', serviceIds)
    .order('display_order')
    .order('id');
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    serviceId: row.service_id,
    name: row.name,
    price: Number(row.price),
    active: row.active,
  }));
}

const QUESTION_COLUMNS =
  'id, category_id, service_id, key, type, label, help_text, required, affects_pricing, options, validation, active';

type QuestionDb = {
  id: string;
  category_id: string;
  service_id: string | null;
  key: string;
  type: string;
  label: unknown;
  help_text: unknown;
  required: boolean;
  affects_pricing: boolean;
  options: unknown;
  validation: unknown;
  active: boolean;
};

function toQuestion(row: QuestionDb): QuestionRow {
  return {
    id: row.id,
    categoryId: row.category_id,
    serviceId: row.service_id,
    key: row.key,
    type: row.type as QuestionType,
    label: row.label,
    helpText: row.help_text,
    required: row.required,
    affectsPricing: row.affects_pricing,
    options: Array.isArray(row.options) ? (row.options as QuestionRow['options']) : null,
    validation: (row.validation as QuestionRow['validation']) ?? null,
    active: row.active,
  };
}

export async function listQuestions(categoryId: string): Promise<QuestionRow[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('questions')
    .select(QUESTION_COLUMNS)
    .eq('category_id', categoryId)
    .order('display_order')
    .order('id');
  if (error) fail(error);
  return ((data ?? []) as QuestionDb[]).map(toQuestion);
}

/**
 * The option values each question key of a category is matched by, in the active formulas (spec 0007 AC-4,
 * AC-18). Such an option cannot be removed; the page says so instead of letting the database refuse.
 */
export async function matchedOptionValues(categoryId: string): Promise<Map<string, string[]>> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('pricing_modifiers')
    .select('question_key, match_value, pricing_formulas!inner(active, services!inner(category_id))')
    .eq('pricing_formulas.active', true)
    .eq('pricing_formulas.services.category_id', categoryId)
    .not('question_key', 'is', null);
  if (error) fail(error);
  const out = new Map<string, string[]>();
  for (const row of (data ?? []) as { question_key: string; match_value: unknown }[]) {
    const values = Array.isArray(row.match_value) ? row.match_value : [row.match_value];
    const kept = values.filter((v): v is string => typeof v === 'string');
    if (kept.length > 0)
      out.set(row.question_key, [...new Set([...(out.get(row.question_key) ?? []), ...kept])]);
  }
  return out;
}

/** Every service of the region, ordered by category, then service (the pricing page's picker and its first). */
export async function listServicesForPricing(
  region: Region,
): Promise<{ id: string; categoryId: string; name: unknown; categoryName: unknown }[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('services')
    .select('id, category_id, name, display_order, service_categories(name, display_order)')
    .eq('region', region);
  if (error) fail(error);
  type Row = {
    id: string;
    category_id: string;
    name: unknown;
    display_order: number;
    service_categories: { name: unknown; display_order: number } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .sort(
      (a, b) =>
        (a.service_categories?.display_order ?? 0) - (b.service_categories?.display_order ?? 0) ||
        a.category_id.localeCompare(b.category_id) ||
        a.display_order - b.display_order ||
        a.id.localeCompare(b.id),
    )
    .map((row) => ({
      id: row.id,
      categoryId: row.category_id,
      name: row.name,
      categoryName: row.service_categories?.name ?? null,
    }));
}

export type ActiveFormula = {
  id: string;
  version: number;
  basePrice: number;
  modifiers: {
    questionKey: string | null;
    matchType: string;
    matchValue: unknown;
    effectType: string;
    amount: number | null;
    factor: string | null;
  }[];
};

export async function activeFormula(serviceId: string): Promise<ActiveFormula | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('pricing_formulas')
    .select(
      'id, version, base_price, pricing_modifiers(apply_order, question_key, match_type, match_value, effect_type, amount, factor)',
    )
    .eq('service_id', serviceId)
    .eq('active', true)
    .maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  type Mod = {
    apply_order: number;
    question_key: string | null;
    match_type: string;
    match_value: unknown;
    effect_type: string;
    amount: number | null;
    factor: number | string | null;
  };
  const modifiers = ((data.pricing_modifiers ?? []) as Mod[])
    .sort((a, b) => a.apply_order - b.apply_order)
    .map((m) => ({
      questionKey: m.question_key,
      matchType: m.match_type,
      matchValue: m.match_value,
      effectType: m.effect_type,
      amount: m.amount === null ? null : Number(m.amount),
      factor: m.factor === null ? null : String(m.factor),
    }));
  return { id: data.id, version: data.version, basePrice: Number(data.base_price), modifiers };
}

/** The questions a service's formula may read: active, priced, of its category, for all or for it. */
export async function pricedQuestions(categoryId: string, serviceId: string): Promise<QuestionRow[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('questions')
    .select(QUESTION_COLUMNS)
    .eq('category_id', categoryId)
    .eq('active', true)
    .eq('affects_pricing', true)
    .or(`service_id.is.null,service_id.eq.${serviceId}`)
    .order('display_order')
    .order('id');
  if (error) fail(error);
  return ((data ?? []) as QuestionDb[]).map(toQuestion);
}
