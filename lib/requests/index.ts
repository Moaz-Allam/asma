import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';
import { raiseAlert } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import { activeCheckoutHosts } from '@/lib/payments/checkout-hosts';
import { isAllowedCheckoutUrl } from '@/lib/payments/checkout-url';
import type { Region } from '@/lib/region';

import { decodeCursor, encodeCursor } from './cursor';
import type { CancelReason, CreateRequestInput, QuoteRequestInput, RequestTab } from './input';
import { prefillFrom as filterPrefill, type Prefill } from './prefill';
import {
  CheckoutStatus,
  ChooseResult,
  CloseInfo,
  CloseResult,
  CommissionFee,
  Contacts,
  CreateRequestResult,
  PayResult,
  Receipt,
  RequestOffers,
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

export type {
  CheckoutStatus,
  CloseInfo,
  CommissionFee,
  Contacts,
  Offer,
  Receipt,
  RequestCatalog,
  RequestOffers,
  RequestQuote,
} from './schemas';

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
  'region_unavailable',
  // Spec 0010 (06): choosing a provider.
  'not_choosable',
  'offer_unavailable',
  'choose_settings_invalid',
  // Spec 0011-07 (07): the fee settings, read by the split and the choose.
  'fee_settings_invalid',
  // Spec 0011-09 (09): paying the commission, and cancel during a checkout.
  'invalid_state',
  'already_paid',
  'deadline_passed',
  'payments_disabled',
  'too_many_checkouts',
  'checkout_open',
  'checkout_settings_invalid',
  'unlock_settings_invalid',
  // Spec 0011-10 (10): the contact window.
  'contact_settings_invalid',
  // Spec 0011-11 (11): the customer's close.
  'too_early',
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

/** The refusal's hint: cancel says `checkout_settings_invalid` there when it failed safe (spec 0011-09 R-6). */
function refusalHint(error: unknown): string | null {
  const hint = typeof error === 'object' && error !== null && 'hint' in error ? error.hint : null;
  return typeof hint === 'string' && hint.length > 0 ? hint : null;
}

async function invoke(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown } | (Refused & { hint: string | null })> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const code = refusalCode(error);
    if (code) return { ok: false, code, hint: refusalHint(error) };
    throw error;
  }
  return { data };
}

async function call(fn: string, args: Record<string, unknown>): Promise<{ data: unknown } | Refused> {
  const result = await invoke(fn, args);
  return 'ok' in result ? { ok: false, code: result.code } : result;
}

/**
 * A settings refusal means no request can be posted in that region: alert. `price_out_of_range` only logs,
 * because a customer's own answers can reach it (AC-11). The record is the service, or `catalog`.
 */
function signal(code: RequestCode, recordId: string, context: Context): void {
  const region = context.region ?? undefined;
  if (
    code === 'pricing_settings_invalid' ||
    code === 'request_settings_invalid' ||
    code === 'choose_settings_invalid' ||
    code === 'fee_settings_invalid' ||
    code === 'checkout_settings_invalid' ||
    code === 'unlock_settings_invalid' ||
    code === 'contact_settings_invalid'
  ) {
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
  if (parsed.status === 'refused') {
    signal(parsed.code, input.serviceId, context);
    return { ok: false, code: parsed.code };
  }
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
  if (parsed.status === 'refused') {
    signal(parsed.code, input.serviceId, context);
    return { ok: false, code: parsed.code };
  }
  return { ok: false, code: 'invalid', errors: parsed.errors };
}

/**
 * The offers on the caller's own request (spec 0010 AC-2): null when the request is not theirs, unknown or
 * malformed, so the page shows 404. The only customer read of applications.
 */
export async function loadOffers(id: string): Promise<RequestOffers | null> {
  if (!UUID.test(id)) return null;
  const result = await call('request_offers', { p_request_id: id });
  if ('ok' in result) throw new Error(`request_offers refused: ${result.code}`);
  return result.data === null ? null : RequestOffers.parse(result.data);
}

export type ChooseOutcome =
  { ok: true; replayed: boolean; selectedAt: string; paymentDeadline: string } | Refused;

/** Choose one offer (spec 0010 AC-7). A replay of the same offer returns the stored answer. */
export async function chooseProvider(
  input: { requestId: string; applicationId: string },
  context: Context,
): Promise<ChooseOutcome> {
  const result = await call('choose_provider', {
    p_request_id: input.requestId,
    p_application_id: input.applicationId,
  });
  if ('ok' in result) {
    signal(result.code, input.requestId, context);
    return result;
  }
  const parsed = ChooseResult.parse(result.data);
  return {
    ok: true,
    replayed: parsed.replayed,
    selectedAt: parsed.selected_at,
    paymentDeadline: parsed.payment_deadline,
  };
}

/**
 * Cancel while OPEN or SELECTED (0008 AC-15, 0010 AC-11). Already cancelled is ok. Since 09 a card page in use
 * refuses `checkout_open` (spec 0011-09 AC-2); when that refusal came from a missing hold setting, alert (R-6).
 */
export async function cancelRequest(
  requestId: string,
  reason: CancelReason | null,
  context?: Context,
): Promise<{ ok: true } | Refused> {
  const result = await invoke('cancel_request', { p_request_id: requestId, p_reason: reason });
  if (!('ok' in result)) return { ok: true };
  if (result.code === 'checkout_open' && result.hint === 'checkout_settings_invalid') {
    raiseAlert('checkout_settings_invalid', { recordId: requestId, region: context?.region ?? undefined });
  }
  return { ok: false, code: result.code };
}

export type PayOutcome =
  | { ok: true; status: 'settled' }
  | { ok: true; status: 'checkout'; attemptId: string; reused: boolean }
  | Refused;

/**
 * Pay the commission (spec 0011-09 AC-4, AC-9): one database function opens the fee and an attempt, or returns
 * a young one, or settles a commission of 0 at once. The locale is the page's; the IP is the one Vercel saw, or
 * null, and is never logged (R-10). No figure is sent: the database charges the stored commission (rule 1).
 */
export async function payCommission(
  input: { requestId: string; locale: 'ar' | 'tr' | 'en'; payerIp: string | null },
  context: Context,
): Promise<PayOutcome> {
  const result = await call('pay_commission', {
    p_request_id: input.requestId,
    p_locale: input.locale,
    p_payer_ip: input.payerIp,
  });
  if ('ok' in result) {
    signal(result.code, input.requestId, context);
    return { ok: false, code: result.code };
  }
  const parsed = PayResult.parse(result.data);
  if (parsed.status === 'settled') return { ok: true, status: 'settled' };
  return { ok: true, status: 'checkout', attemptId: parsed.attempt_id, reused: parsed.reused };
}

/**
 * One attempt as its payer reads it (spec 0011-09 AC-7, AC-9), or null: another's, unknown or malformed (R-13).
 * The card page URL leaves the server only when it is on the active driver's hosts; else it is dropped and
 * `checkout_url_refused` is logged with the attempt id only.
 */
export async function checkoutStatus(attemptId: string): Promise<CheckoutStatus | null> {
  if (!UUID.test(attemptId)) return null;
  const result = await call('my_checkout', { p_attempt_id: attemptId });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`my_checkout refused: ${result.code}`);
  }
  const status = CheckoutStatus.parse(result.data);
  if (status.url !== null && !isAllowedCheckoutUrl(status.url, activeCheckoutHosts())) {
    log.warn('checkout_url_refused', { request_id: attemptId });
    return { ...status, url: null };
  }
  return status;
}

/** A receipt of the caller's own paid fee (spec 0011-09 AC-13), or null (R-13). */
export async function loadReceipt(feeId: string): Promise<Receipt | null> {
  if (!UUID.test(feeId)) return null;
  const result = await call('my_receipt', { p_receipt_id: feeId });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`my_receipt refused: ${result.code}`);
  }
  return Receipt.parse(result.data);
}

/**
 * The other side's contacts (spec 0011-10 AC-5), or null: before both fees, past the window, a suspended
 * provider, anyone else (the database answers `not_found` alike). Postgres decides (rule 2); the first read
 * of each side is audited there. A missing window setting alerts and reads as hidden.
 */
export async function loadContacts(requestId: string, context: Context): Promise<Contacts | null> {
  if (!UUID.test(requestId)) return null;
  const result = await call('request_contacts', { p_request_id: requestId });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    signal(result.code, requestId, context);
    if (result.code === 'contact_settings_invalid') return null;
    throw new Error(`request_contacts refused: ${result.code}`);
  }
  return Contacts.parse(result.data);
}

/**
 * The customer's close (spec 0011-11 AC-4, AC-5): Confirm after the provider's Done, or "Job done" from the start
 * day. No money moves (D91). A second press is a replay; a job the auto close already closed is `invalid_state`.
 */
export async function closeJob(
  move: 'confirm' | 'mark_done',
  requestId: string,
): Promise<{ ok: true; replayed: boolean } | Refused> {
  if (!UUID.test(requestId)) return { ok: false, code: 'not_found' };
  const result = await call(move === 'confirm' ? 'confirm_job' : 'customer_mark_done', {
    p_request_id: requestId,
  });
  if ('ok' in result) return result;
  return { ok: true, replayed: CloseResult.parse(result.data).replayed };
}

/** How the customer's page words the close (spec 0011-11 R-2, R-5), or null for anyone else's request. */
export async function loadCloseInfo(requestId: string): Promise<CloseInfo | null> {
  if (!UUID.test(requestId)) return null;
  const result = await call('request_close_info', { p_request_id: requestId });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`request_close_info refused: ${result.code}`);
  }
  return CloseInfo.parse(result.data);
}

/** The commission row of the caller's own request, read through RLS (spec 0011-09 AC-10), or null. */
export async function loadCommissionFee(requestId: string): Promise<CommissionFee | null> {
  if (!UUID.test(requestId)) return null;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('fee_payments')
    .select('id, status, paid_at')
    .eq('request_id', requestId)
    .eq('kind', 'commission')
    .maybeSingle();
  if (error) throw error;
  return data ? CommissionFee.parse(data) : null;
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
  'id, status, service_id, zone_id, addon_ids, answers, questions_snapshot, pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes, cancelled_at, cancel_reason, created_at, fee_deadline, actual_started_at, actual_completed_at, confirm_deadline, closed_at, closed_by, region_info:regions(timezone)';

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
