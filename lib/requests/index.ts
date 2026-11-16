import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import { raiseAlert } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import type { Region } from '@/lib/region';

import { decodeCursor, encodeCursor } from './cursor';
import type { CancelReason, CreateRequestInput, QuoteRequestInput, RequestTab } from './input';
import { prefillFrom as filterPrefill, type Prefill } from './prefill';
import {
  CreateRequestResult,
  QuoteRequestResult,
  RequestCatalog,
  RequestDetailRow,
  RequestListRow,
  type RequestQuote,
} from './schemas';

/**
 * The app's one door to requests (spec 0008, API surface). Every figure is computed in Postgres: the quote
 * and its split by `quote_request`, the stored price, commission and cash due by `create_request`. No
 * function here computes money (rule 1, rule 4). Each wrapper calls the database as the signed in user,
 * parses the result, and maps each refusal to a stable code. A mapped code reaches no Sentry report;
 * anything else is thrown for `guardedAction` or the page to report.
 */

export type { CatalogQuestion, CatalogService, RequestCatalog, RequestQuote } from './schemas';
export type { RequestDetailRow, RequestListRow, PricingSnapshot, QuestionSnapshot } from './schemas';

/** Every code the request functions raise. */
export const REQUEST_DB_CODES = [
  'forbidden',
  'validation_failed',
  'service_unavailable',
  'zone_unavailable',
  'addon_unavailable',
  'price_out_of_range',
  'pricing_settings_invalid',
  'request_settings_invalid',
  'too_many_quotes',
  'schedule_invalid',
  'address_invalid',
  'notes_invalid',
  'contact_info_in_notes',
  'too_many_open_requests',
  'not_found',
  'not_cancellable',
] as const;
export type RequestCode = (typeof REQUEST_DB_CODES)[number];

type Refused = { ok: false; code: RequestCode };
type Context = { region: Region | null; userId: string };

function refusalCode(error: unknown): RequestCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (REQUEST_DB_CODES as readonly string[]).includes(message)
    ? (message as RequestCode)
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

/**
 * A settings refusal means no request can be posted in that region: alert. `price_out_of_range` only logs,
 * because a customer's own answers can reach it (AC-11). The record is the service, or `catalog`.
 */
function signal(code: RequestCode, recordId: string, context: Context): void {
  const region = context.region ?? undefined;
  if (code === 'pricing_settings_invalid' || code === 'request_settings_invalid') {
    raiseAlert(code, { recordId, region });
  } else if (code === 'price_out_of_range') {
    log.warn('price_out_of_range', { region, user_id: context.userId });
  }
}

export type CatalogOutcome = { ok: true; catalog: RequestCatalog } | Refused;

/** The customer's only read of the catalog (AC-4), for the caller's region. */
export async function loadRequestCatalog(context: Context): Promise<CatalogOutcome> {
  const result = await call('request_catalog', {});
  if ('ok' in result) {
    signal(result.code, 'catalog', context);
    return result;
  }
  return { ok: true, catalog: RequestCatalog.parse(result.data) };
}

export type QuoteOutcome =
  | { ok: true; quote: RequestQuote }
  | { ok: false; code: 'invalid'; errors: { key: string | null; code: string }[] }
  | Refused;

/** A quote with its split (AC-5), counted against the caller's hourly limit (AC-28). */
export async function quoteRequest(input: QuoteRequestInput, context: Context): Promise<QuoteOutcome> {
  const result = await call('quote_request', {
    p_service_id: input.serviceId,
    p_zone_id: input.zoneId,
    p_addon_ids: input.addonIds,
    p_answers: input.answers,
  });
  if ('ok' in result) {
    signal(result.code, input.serviceId, context);
    return result;
  }
  const parsed = QuoteRequestResult.parse(result.data);
  return parsed.status === 'ok'
    ? { ok: true, quote: parsed }
    : { ok: false, code: 'invalid', errors: parsed.errors };
}

export type CreateOutcome =
  | { ok: true; id: string }
  | { ok: false; code: 'invalid'; errors: { key: string | null; code: string }[] }
  | { ok: false; code: 'price_changed'; quote: RequestQuote }
  | Refused;

/**
 * Publish (AC-7). The expected figures are the last quote the form showed; the database compares them and
 * stores its own (D140). A replay with the same client key returns the first id (AC-12).
 */
export async function createRequest(input: CreateRequestInput, context: Context): Promise<CreateOutcome> {
  const result = await call('create_request', {
    p_client_key: input.clientKey,
    p_service_id: input.serviceId,
    p_zone_id: input.zoneId,
    p_addon_ids: input.addonIds,
    p_answers: input.answers,
    p_start_date: input.startDate,
    p_start_hour: input.startHour,
    p_address_line: input.addressLine,
    p_notes: input.notes,
    p_expected_price: input.expectedPrice,
    p_expected_commission: input.expectedCommission,
  });
  if ('ok' in result) {
    signal(result.code, input.serviceId, context);
    return result;
  }
  const parsed = CreateRequestResult.parse(result.data);
  if (parsed.status === 'ok') return { ok: true, id: parsed.id };
  if (parsed.status === 'price_changed') return { ok: false, code: 'price_changed', quote: parsed.quote };
  return { ok: false, code: 'invalid', errors: parsed.errors };
}

/** Cancel while OPEN (AC-15). Already cancelled is ok. */
export async function cancelRequest(
  requestId: string,
  reason: CancelReason | null,
): Promise<{ ok: true } | Refused> {
  const result = await call('cancel_request', { p_request_id: requestId, p_reason: reason });
  return 'ok' in result ? result : { ok: true };
}

const PAGE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = ['SELECTED', 'COMMISSION_PAID', 'UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'];

const LIST_COLUMNS =
  'id, status, fixed_price, currency, scheduled_start_at, created_at, service:pricing_snapshot->service, zone_name:pricing_snapshot->breakdown->zone->name, region_info:regions(timezone)';

/** A PostgREST filter value with reserved characters, double quoted. */
const quoted = (value: string) => `"${value.replace(/["\\]/g, '')}"`;

export type RequestPage = { rows: RequestListRow[]; next: string | null; now: string };

/**
 * The caller's own requests, newest first, 20 a page (AC-13). Tabs filter in the query against the server's
 * clock: Active is OPEN with a future start plus SELECTED to AWAITING_CONFIRMATION; Closed is CANCELLED,
 * COMPLETED and OPEN with a past start. An admin sees only their own here too.
 */
export async function listMyRequests(input: {
  userId: string;
  tab: RequestTab;
  after: unknown;
}): Promise<RequestPage> {
  const now = new Date().toISOString();
  const supabase = await createSupabaseServer();
  let query = supabase
    .from('requests')
    .select(LIST_COLUMNS)
    .eq('customer_id', input.userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE + 1);

  const groups: string[] = [];
  if (input.tab === 'active') {
    groups.push(`or(and(status.eq.OPEN,scheduled_start_at.gt.${quoted(now)}),status.in.(${LIVE.join(',')}))`);
  } else if (input.tab === 'closed') {
    groups.push(
      `or(status.in.(CANCELLED,COMPLETED),and(status.eq.OPEN,scheduled_start_at.lte.${quoted(now)}))`,
    );
  }
  const cursor = decodeCursor(input.after);
  if (cursor) {
    const at = quoted(cursor.createdAt);
    groups.push(`or(created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id}))`);
  }
  if (groups.length > 0) query = query.or(`and(${groups.join(',')})`);

  const { data, error } = await query;
  if (error) throw error;
  const rows = RequestListRow.array().parse(data ?? []);
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);
  return {
    rows: page,
    next: rows.length > PAGE && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    now,
  };
}

export type MyRequest = { request: RequestDetailRow; addressLine: string | null; now: string };

const DETAIL_COLUMNS =
  'id, status, service_id, zone_id, addon_ids, answers, questions_snapshot, pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes, cancelled_at, cancel_reason, created_at, region_info:regions(timezone)';

/** One of the caller's own requests and its address, or null: another's, unknown or malformed (AC-14). */
export async function getMyRequest(input: { userId: string; id: string }): Promise<MyRequest | null> {
  if (!UUID.test(input.id)) return null;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('requests')
    .select(DETAIL_COLUMNS)
    .eq('id', input.id)
    .eq('customer_id', input.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const request = RequestDetailRow.parse(data);
  const address = await supabase
    .from('request_addresses')
    .select('line')
    .eq('request_id', request.id)
    .maybeSingle();
  if (address.error) throw address.error;
  return { request, addressLine: address.data?.line ?? null, now: new Date().toISOString() };
}

/**
 * Repeat (AC-16): the caller's own request, filtered against the catalog as it is now. Another customer's
 * id, an unknown or a malformed one prefill nothing, silently.
 */
export async function prefillFrom(input: {
  userId: string;
  id: unknown;
  catalog: RequestCatalog;
}): Promise<Prefill | null> {
  if (typeof input.id !== 'string') return null;
  const found = await getMyRequest({ userId: input.userId, id: input.id });
  if (!found) return null;
  return filterPrefill(input.catalog, {
    serviceId: found.request.service_id,
    zoneId: found.request.zone_id,
    addonIds: found.request.addon_ids,
    answers: found.request.answers,
    notes: found.request.notes,
    addressLine: found.addressLine,
  });
}
