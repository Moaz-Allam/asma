import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import { raiseAlert } from '@/lib/observability/alert';
import type { FlagOutcome } from '@/lib/quality/summary';

import {
  AdminProviderQuality,
  EndProbationResult,
  Funnel,
  HandleFlagResult,
  ProbationPage,
  QualityFlagsPage,
  type FunnelRegion,
} from './schemas';

/**
 * Admin's one door to trust and quality (spec 0011-19a AC-5, AC-9 to AC-13). Each wrapper calls a definer function
 * as the signed in admin; `is_admin()` is checked inside each. Nothing here computes a figure (Postgres does, when
 * read) or sends one: a handle names the flag, an outcome and a note; ending probation names the provider and a
 * note. Notes go only to the flag, the waiver and `audit_log`. A mapped code reaches no Sentry report; anything else
 * is thrown for `guardedAction` or the page to report.
 */

export type { AdminProviderQuality, FunnelRegion, ProbationRow, QualityFlagRow } from './schemas';

export const ADMIN_QUALITY_DB_CODES = [
  'forbidden',
  'validation_failed',
  'reason_required',
  'not_found',
  'already_handled',
  'not_approved',
  'not_on_probation',
  'already_waived',
  'quality_settings_invalid',
] as const;
export type AdminQualityCode = (typeof ADMIN_QUALITY_DB_CODES)[number];

type Refused = { ok: false; code: AdminQualityCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Fn =
  | 'admin_quality_flags'
  | 'admin_handle_quality_flag'
  | 'admin_probation'
  | 'admin_end_probation'
  | 'admin_quality_funnel'
  | 'admin_provider_quality';

function refusalCode(error: unknown): AdminQualityCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (ADMIN_QUALITY_DB_CODES as readonly string[]).includes(message)
    ? (message as AdminQualityCode)
    : null;
}

async function call(fn: Fn, args: Record<string, unknown>): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) {
    const code = refusalCode(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

function pageOf(page: number): number {
  return Number.isFinite(page) ? Math.min(10000, Math.max(1, Math.floor(page))) : 1;
}

/** AC-10: one page (20, oldest first) of open flags. */
export async function loadQualityFlags(page: number): Promise<QualityFlagsPage> {
  const result = await call('admin_quality_flags', { p_page: pageOf(page) });
  if ('ok' in result) throw new Error(`admin_quality_flags refused: ${result.code}`);
  return QualityFlagsPage.parse(result.data);
}

/** AC-9: warn, suspend or clear one open flag, once, with a note of 10 to 500 characters (Postgres judges). */
export async function handleQualityFlag(input: {
  flagId: string;
  outcome: FlagOutcome;
  note: string;
}): Promise<{ ok: true; outcome: FlagOutcome } | Refused> {
  if (!UUID.test(input.flagId)) return { ok: false, code: 'not_found' };
  const result = await call('admin_handle_quality_flag', {
    p_flag_id: input.flagId,
    p_outcome: input.outcome,
    p_note: input.note,
  });
  if ('ok' in result) return result;
  return { ok: true, outcome: HandleFlagResult.parse(result.data).outcome };
}

/** AC-11: one page (20, longest approved first) of providers on probation. */
export async function loadProbation(page: number): Promise<ProbationPage> {
  const result = await call('admin_probation', { p_page: pageOf(page) });
  if ('ok' in result) throw new Error(`admin_probation refused: ${result.code}`);
  return ProbationPage.parse(result.data);
}

/** AC-5: end one provider's probation, once (a waiver is final), with a note. */
export async function endProbation(input: {
  providerId: string;
  note: string;
}): Promise<{ ok: true } | Refused> {
  if (!UUID.test(input.providerId)) return { ok: false, code: 'not_on_probation' };
  const result = await call('admin_end_probation', { p_provider_id: input.providerId, p_note: input.note });
  if ('ok' in result) return result;
  EndProbationResult.parse(result.data);
  return { ok: true };
}

/** AC-12: every region's stages and its acceptance rate by month. Admin only; no public claim uses it (B7). */
export async function loadFunnel(): Promise<FunnelRegion[]> {
  const result = await call('admin_quality_funnel', {});
  if ('ok' in result) throw new Error(`admin_quality_funnel refused: ${result.code}`);
  return Funnel.parse(result.data);
}

/**
 * AC-13: one provider's figures for their admin page. Null for a malformed or unknown id; `unavailable` (and the
 * alert) when the region's quality settings are broken.
 */
export async function loadProviderQuality(
  providerId: string,
): Promise<{ state: 'ok'; quality: AdminProviderQuality } | { state: 'unavailable' } | null> {
  if (!UUID.test(providerId)) return null;
  const result = await call('admin_provider_quality', { p_provider_id: providerId });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    if (result.code === 'quality_settings_invalid') {
      raiseAlert('quality_settings_invalid', { recordId: providerId });
      return { state: 'unavailable' };
    }
    throw new Error(`admin_provider_quality refused: ${result.code}`);
  }
  return { state: 'ok', quality: AdminProviderQuality.parse(result.data) };
}
