import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import type { Region } from '@/lib/region';

import type { CatalogTable } from './options';

/**
 * Admin's direct writes on the five catalog tables (spec 0007, Feature design). RLS and column grants
 * decide: an admin inserts every column but `id` and `created_at`, and updates none of the region, the
 * parent ids, or a question's key and type. So a write never upserts. It inserts or it updates, always
 * with `.select('id')`: RLS filters an update silently, and a token's role can lag behind `is_admin()`
 * after a demotion, so zero rows back means `forbidden`.
 *
 * Every write throws the PostgREST error as it came, for `catalogCode` to map.
 */

/** Postgres codes on a direct write, to the codes a page shows. */
const SQLSTATE: Readonly<Record<string, string>> = {
  '23505': 'key_taken',
  '23514': 'validation_failed',
  '23503': 'validation_failed',
  '22P02': 'validation_failed',
  '42501': 'forbidden',
};

/** The stable code of a refusal, or null for an error nobody can act on (reported). */
export function catalogCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (message === 'question_in_use') return 'question_in_use';
  if (typeof code === 'string' && code in SQLSTATE) return SQLSTATE[code] ?? null;
  return null;
}

export class ZeroRows extends Error {
  constructor() {
    super('forbidden');
  }
}

/** Which column a row's order is counted within. */
const SCOPE: Readonly<Record<CatalogTable, string>> = {
  service_categories: 'region',
  services: 'category_id',
  addons: 'service_id',
  zones: 'region',
  questions: 'category_id',
};

async function nextOrder(table: CatalogTable, scopeValue: string): Promise<number> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from(table)
    .select('display_order')
    .eq(SCOPE[table], scopeValue)
    .order('display_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.display_order ?? 0) + 1;
}

/** The region of a parent row, read as the admin. Null when the admin cannot see it. */
export async function parentRegion(
  table: 'service_categories' | 'services',
  id: string,
): Promise<Region | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from(table).select('region').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data?.region as Region | undefined) ?? null;
}

/** Insert a row at the end of its scope; returns its id. */
export async function insertRow(
  table: CatalogTable,
  row: Record<string, unknown>,
  scopeValue: string,
): Promise<string> {
  const supabase = await createSupabaseServer();
  const display_order = await nextOrder(table, scopeValue);
  const { data, error } = await supabase
    .from(table)
    .insert({ ...row, display_order })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Update named columns of one row; zero rows back is `forbidden`. */
export async function updateRow(
  table: CatalogTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new ZeroRows();
}

/**
 * Move one row up or down within its scope. Reads the scope in `display_order`, `id` order, moves the row,
 * then writes 1 to n to the rows whose order changed. A move that fails halfway leaves a tie that breaks
 * on `id`, and the next move renumbers the scope (spec 0007, Failure handling).
 */
export async function moveRow(table: CatalogTable, id: string, direction: 'up' | 'down'): Promise<void> {
  const supabase = await createSupabaseServer();
  const scope = SCOPE[table];
  const { data: row, error: rowError } = await supabase.from(table).select(scope).eq('id', id).maybeSingle();
  if (rowError) throw rowError;
  if (!row) throw new ZeroRows();
  const scopeValue = (row as unknown as Record<string, string>)[scope];
  const { data: rows, error } = await supabase
    .from(table)
    .select('id, display_order')
    .eq(scope, scopeValue)
    .order('display_order')
    .order('id');
  if (error) throw error;
  const ids = (rows ?? []).map((r) => r.id as string);
  const from = ids.indexOf(id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return;
  const moved = ids[from] as string;
  ids[from] = ids[to] as string;
  ids[to] = moved;
  const current = new Map((rows ?? []).map((r) => [r.id as string, r.display_order as number]));
  for (const [index, rowId] of ids.entries()) {
    if (current.get(rowId) !== index + 1) await updateRow(table, rowId, { display_order: index + 1 });
  }
}
