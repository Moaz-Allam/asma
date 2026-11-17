import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import { raiseAlert } from '@/lib/observability/alert';
import type { Region } from '@/lib/region';
import { decodeCursor, encodeCursor } from '@/lib/requests/cursor';

import {
  PROVIDER_FEED_DB_CODES,
  SETUP_FIELDS,
  type JobTab,
  dateRange,
  todayIn,
  type ProviderFeedCode,
  type SetupField,
  type When,
} from './constants';
import { decodeFeedCursor, encodeFeedCursor } from './cursor';
import type { ApplyInput, SaveSetupInput } from './input';
import {
  ApplicationsPage,
  ApplyResult,
  FeedPage,
  HomeCounts,
  JobMoveResult,
  JobsPage,
  PayFeeResult,
  ProviderSetup,
  RequestDetail,
  type OwnApplication,
} from './schemas';

/**
 * The provider's one door to position 05 (spec 0009, API surface). Every rule lives in a definer function:
 * standing, setup coverage, the request's state, the cap, the hourly limit and the contact scanner. Each
 * wrapper calls the database as the signed in provider, parses the result with a strict schema, and maps
 * each refusal to a stable code. A mapped code reaches no Sentry report, except `apply_settings_invalid`,
 * which alerts (AC-1, AC-11). Nothing here computes money (rule 1, rule 4).
 */

export type {
  ApplicationListRow,
  JobRow,
  FeedRow,
  OwnApplication,
  ProviderSetup,
  RequestDetail,
  StructuredAnswer,
} from './schemas';

type Refused = { ok: false; code: ProviderFeedCode; field?: SetupField };
type Context = { region: Region | null };

function refusal(error: unknown): Refused | null {
  if (typeof error !== 'object' || error === null || !('message' in error)) return null;
  const message = error.message;
  if (typeof message !== 'string' || !(PROVIDER_FEED_DB_CODES as readonly string[]).includes(message))
    return null;
  const details = 'details' in error ? error.details : null;
  const field =
    typeof details === 'string' && (SETUP_FIELDS as readonly string[]).includes(details)
      ? (details as SetupField)
      : undefined;
  return { ok: false, code: message as ProviderFeedCode, ...(field ? { field } : {}) };
}

async function call(
  fn: string,
  args: Record<string, unknown>,
  context: Context,
): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const refused = refusal(error);
    if (!refused) throw error;
    // The cap or the hourly limit is missing or malformed: nobody in the region can apply.
    if (refused.code === 'apply_settings_invalid') {
      raiseAlert('apply_settings_invalid', { recordId: fn, region: context.region ?? undefined });
    }
    // Spec 0011-10 AC-8: a missing checkout or window setting stops every provider fee in the region.
    if (
      refused.code === 'checkout_settings_invalid' ||
      refused.code === 'unlock_settings_invalid' ||
      refused.code === 'confirm_settings_invalid'
    ) {
      raiseAlert(refused.code, { recordId: fn, region: context.region ?? undefined });
    }
    return refused;
  }
  return { data };
}

/** `p4` (AC-2): the caller's picks beside every offered service and active district of their region. */
export async function loadSetup(context: Context): Promise<{ ok: true; setup: ProviderSetup } | Refused> {
  const result = await call('provider_setup', {}, context);
  return 'ok' in result ? result : { ok: true, setup: ProviderSetup.parse(result.data) };
}

/** AC-3: replaces the three sets. A refusal names its field. */
export async function saveSetup(input: SaveSetupInput, context: Context): Promise<{ ok: true } | Refused> {
  const result = await call(
    'save_provider_setup',
    {
      p_service_ids: input.serviceIds,
      p_zone_ids: input.zoneIds,
      p_work_days: input.workDays,
      p_start_hour: input.startHour,
      p_end_hour: input.endHour,
    },
    context,
  );
  return 'ok' in result ? result : { ok: true };
}

/** The region's time zone, read from the caller's own region row (Value sourcing, date chips). */
async function regionTimezone(region: Region): Promise<string> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from('regions').select('timezone').eq('code', region).single();
  if (error) throw error;
  return String(data.timezone);
}

export type FeedFilters = {
  serviceIds: string[] | null;
  zoneIds: string[] | null;
  when: When;
  after: string | null;
};
export type FeedResult = { ok: true; page: FeedPage; next: string | null } | Refused;

/** AC-5: one page of the feed. Filters only narrow; the database intersects them with the setup. */
export async function loadFeed(filters: FeedFilters, locale: string, context: Context): Promise<FeedResult> {
  const range =
    filters.when === 'all' || !context.region
      ? null
      : dateRange(todayIn(await regionTimezone(context.region)), locale, filters.when);
  const cursor = decodeFeedCursor(filters.after);
  const result = await call(
    'provider_feed',
    {
      p_service_ids: filters.serviceIds,
      p_zone_ids: filters.zoneIds,
      p_from: range?.from ?? null,
      p_to: range?.to ?? null,
      p_after_outside: cursor?.outside ?? null,
      p_after_start: cursor?.start ?? null,
      p_after_id: cursor?.id ?? null,
    },
    context,
  );
  if ('ok' in result) return result;
  const page = FeedPage.parse(result.data);
  const last = page.rows.at(-1);
  const next =
    page.has_more && last
      ? encodeFeedCursor({ outside: last.outside_hours, start: last.scheduled_start_at, id: last.id })
      : null;
  return { ok: true, page, next };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AC-8: one request's short details, or null when the caller may not read it (the page shows 404). */
export async function loadRequest(
  id: string,
  context: Context,
): Promise<{ ok: true; request: RequestDetail | null } | Refused> {
  if (!UUID.test(id)) return { ok: true, request: null };
  const result = await call('provider_request', { p_request_id: id }, context);
  if ('ok' in result) return result;
  return { ok: true, request: result.data === null ? null : RequestDetail.parse(result.data) };
}

export type ApplyOutcome = { ok: true; replayed: boolean; application: OwnApplication } | Refused;

/** AC-10: the only way to apply. The message never leaves this call: not in a log, an error or an event. */
export async function applyToRequest(input: ApplyInput, context: Context): Promise<ApplyOutcome> {
  const result = await call(
    'apply_to_request',
    { p_request_id: input.requestId, p_message: input.applicationMessage },
    context,
  );
  if ('ok' in result) return result;
  const parsed = ApplyResult.parse(result.data);
  if (parsed.status === 'refused') return { ok: false, code: parsed.code };
  return { ok: true, replayed: parsed.replayed, application: parsed.application };
}

/** AC-13: the caller's applications, newest first, 20 a page. */
export async function listApplications(
  after: string | null,
  context: Context,
): Promise<{ ok: true; page: ApplicationsPage; next: string | null } | Refused> {
  const cursor = decodeCursor(after);
  const result = await call(
    'provider_applications',
    { p_after_created_at: cursor?.createdAt ?? null, p_after_id: cursor?.id ?? null },
    context,
  );
  if ('ok' in result) return result;
  const page = ApplicationsPage.parse(result.data);
  const last = page.rows.at(-1);
  const next =
    page.has_more && last
      ? encodeCursor({ createdAt: last.application.created_at, id: last.application.id })
      : null;
  return { ok: true, page, next };
}

/**
 * Pay the provider fee (spec 0011-10 AC-2, AC-8): one database function opens the fee and an attempt, or returns
 * a young one, or settles a fee of 0 at once. The client sends the application id only; the database charges the
 * fee frozen at the choose (rule 1). The IP is the one Vercel saw, or null, and is never logged.
 */
export async function payProviderFee(
  input: { applicationId: string; locale: 'ar' | 'tr' | 'en'; payerIp: string | null },
  context: Context,
): Promise<
  | { ok: true; status: 'settled' }
  | { ok: true; status: 'checkout'; attemptId: string; reused: boolean }
  | Refused
> {
  const result = await call(
    'pay_provider_fee',
    { p_application_id: input.applicationId, p_locale: input.locale, p_payer_ip: input.payerIp },
    context,
  );
  if ('ok' in result) return result;
  const parsed = PayFeeResult.parse(result.data);
  if (parsed.status === 'settled') return { ok: true, status: 'settled' };
  return { ok: true, status: 'checkout', attemptId: parsed.attempt_id, reused: parsed.reused };
}

/** Spec 0011-10 R-11: one My jobs tab, newest change first, 20 a page. No contact field. */
export async function listJobs(
  tab: JobTab,
  after: string | null,
  context: Context,
): Promise<{ ok: true; page: JobsPage; next: string | null } | Refused> {
  const cursor = decodeCursor(after);
  const result = await call(
    'provider_jobs',
    { p_tab: tab, p_after_changed_at: cursor?.createdAt ?? null, p_after_id: cursor?.id ?? null },
    context,
  );
  if ('ok' in result) return result;
  const page = JobsPage.parse(result.data);
  const last = page.rows.at(-1);
  const next =
    page.has_more && last
      ? encodeCursor({ createdAt: last.status_changed_at, id: last.application_id })
      : null;
  return { ok: true, page, next };
}

/**
 * Started and Done (spec 0011-11 AC-2, AC-3): the provider's word on the job, no money attached (D91). Only the
 * selected, unlocked, approved provider; the start day is decided in Postgres. A second press is a replay.
 */
export async function moveJob(
  move: 'start' | 'finish',
  requestId: string,
  context: Context,
): Promise<{ ok: true; replayed: boolean } | Refused> {
  const result = await call(
    move === 'start' ? 'start_job' : 'finish_job',
    { p_request_id: requestId },
    context,
  );
  if ('ok' in result) return result;
  return { ok: true, replayed: JobMoveResult.parse(result.data).replayed };
}

/** AC-14: the two counts of the provider home. */
export async function loadHomeCounts(context: Context): Promise<{ ok: true; counts: HomeCounts } | Refused> {
  const result = await call('provider_home_counts', {}, context);
  return 'ok' in result ? result : { ok: true, counts: HomeCounts.parse(result.data) };
}
