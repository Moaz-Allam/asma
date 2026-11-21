import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import { raiseAlert } from '@/lib/observability/alert';
import type { HideReason } from '@/lib/ratings/summary';

import { AdminProviderRatings, HideResult } from './schemas';

/**
 * Admin's one door to ratings (spec 0011-17 AC-8). Each wrapper calls a definer function as the signed in admin;
 * `is_admin()` is checked inside each. No path changes a score: a hide is its own row, final, with a reason and a
 * note that go only to `rating_hides` and `audit_log`. A mapped code reaches no Sentry report; anything else is
 * thrown for `guardedAction` or the page to report.
 */

export type { AdminProviderRatings, AdminRatingRow } from './schemas';

export const ADMIN_RATING_DB_CODES = [
  'forbidden',
  'validation_failed',
  'not_found',
  'already_hidden',
] as const;
export type AdminRatingCode = (typeof ADMIN_RATING_DB_CODES)[number];

type Refused = { ok: false; code: AdminRatingCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refusalCode(error: unknown): AdminRatingCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (ADMIN_RATING_DB_CODES as readonly string[]).includes(message)
    ? (message as AdminRatingCode)
    : null;
}

async function call(
  fn: 'admin_provider_ratings' | 'admin_hide_rating',
  args: Record<string, unknown>,
): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) {
    const code = refusalCode(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

/** One page (20 rows, newest first) of a provider's ratings with the summary. Null for a malformed or unknown id. */
export async function loadProviderRatings(
  providerId: string,
  page: number,
): Promise<AdminProviderRatings | null> {
  if (!UUID.test(providerId)) return null;
  const result = await call('admin_provider_ratings', {
    p_provider_id: providerId,
    p_page: Math.max(1, Math.floor(page)),
  });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`admin_provider_ratings refused: ${result.code}`);
  }
  const ratings = AdminProviderRatings.parse(result.data);
  // AC-10: a broken rating setting shows no score anywhere in the region.
  if (ratings.summary.state === 'unavailable') {
    raiseAlert('rating_settings_invalid', { recordId: providerId });
  }
  return ratings;
}

/** Hide one rating, once, with a reason and a note of 1 to 500 characters (Postgres trims and judges). */
export async function hideRating(input: {
  ratingId: string;
  reason: HideReason;
  note: string;
}): Promise<{ ok: true; hiddenAt: string } | Refused> {
  if (!UUID.test(input.ratingId)) return { ok: false, code: 'not_found' };
  const result = await call('admin_hide_rating', {
    p_rating_id: input.ratingId,
    p_reason: input.reason,
    p_note: input.note,
  });
  if ('ok' in result) return result;
  return { ok: true, hiddenAt: HideResult.parse(result.data).hidden_at };
}
