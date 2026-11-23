/**
 * The one scrubber. Spec 0004 AC-3 and its key invariants: personal data never leaves.
 *
 * It walks USER DATA fields only (event `extra`, `request`, breadcrumb `data`, log attributes, span
 * attributes, user defined `contexts`, replay URLs) and never the fields the SDK owns (ids, release,
 * environment, sdk, tags, fingerprint, the trace and device contexts), so grouping and trace joins
 * keep working. Inside user data:
 *   - a value under a personal key is replaced by FILTERED (the key stays, so the shape is visible);
 *     keys match after camelCase, `-` and `.` are folded to `_` (`phoneNumber` is `phone_number`);
 *   - every URL, alone or inside text, keeps only the `utm_*` and `page` parameters (D85), and loses
 *     every fragment and any credentials;
 *   - email addresses and IPv4/IPv6 addresses are redacted anywhere;
 *   - phone numbers are redacted in message like fields only (messages, exception values, console
 *     arguments, log templates), with the anchored pattern below, so trace ids, uuids and commit SHAs
 *     survive everywhere.
 * `request` is reduced to method, url, query string and allow listed headers; `user` is never sent.
 * The walk is bounded: a cycle, a value seen before, or anything past the node budget becomes FILTERED,
 * so a cyclic or huge console argument costs linear time, never exponential.
 * Every exported function fails closed: if scrubbing throws, it returns null and the caller drops the
 * payload. No SDK import here, so the browser, the server, logs and replays share exactly one copy.
 */

export const FILTERED = '[Filtered]';

const PERSONAL_KEYS: ReadonlySet<string> = new Set([
  'name',
  'first_name',
  'last_name',
  'full_name',
  'user_name',
  'username',
  'customer_name',
  'display_name',
  'email',
  'phone',
  'phone_number',
  // Spec 0011-10 (S10-9): the wa.me link carries the phone digits.
  'whatsapp',
  'contact',
  'address',
  'street',
  'district',
  'city',
  'postal_code',
  'building',
  'apartment',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'location',
  'coordinates',
  'iban',
  'card',
  'card_number',
  'password',
  'otp',
  'token',
  'secret',
  'jwt',
  'authorization',
  'cookie',
  'note',
  // Spec 0011-14 AC-9, X-23: a report's text and admin's note on it.
  'text',
  'admin_note',
  // Spec 0008 AC-18: a request's street line, its notes and the answers a customer typed.
  'line',
  'address_line',
  'notes',
  'answers',
  // Spec 0009 AC-20: a provider's apply message, as the action names it and as the RPC argument.
  'application_message',
  'p_message',
  // Spec 0011-19b: a provider's answers to the application questions, as the action and provider_request name them.
  'application_answers',
  'description',
  'message',
  'body',
  'comment',
  // Spec 0011-13 AC-9: a rendered mail's subject and HTML. Exact keys: `to` is already a URL key here, and
  // `text` is too common to drop everywhere.
  'subject',
  'html',
  // Postgres error fields: they quote the row that failed, such as `Key (phone)=(+90…) already exists.`
  'detail',
  'details',
  'hint',
  'national_id',
  'tckn',
  'identity_number',
  'passport',
  'tax_id',
  'tax_number',
  'birth_date',
  'date_of_birth',
  'dob',
  // Spec 0011-08 AC-16: the PSP's buyer, the checkout token (`token`, `psp_token` by suffix) and the card
  // page, as iyzico names them (camelCase folds to these).
  'buyer',
  'payment_page_url',
  'checkout_form_content',
  'gsm_number',
  'ip',
  'payer_ip',
  // Spec 0011-09 R-10: pay_commission's argument, should a failed call's arguments ever be logged.
  'p_payer_ip',
  // Spec 0011-20: a service agreement's frozen content (both parties' names, phones and the street line).
  'content',
  'agreement_content',
]);
const PERSONAL_SUFFIXES = [
  // Spec 0008 (review A5): the request RPC arguments p_address_line, p_notes, p_answers.
  '_line',
  '_notes',
  // Spec 0011-14 X-23: p_text, p_note and any other `_text` or `_note` argument.
  '_text',
  '_note',
  '_answers',
  '_email',
  '_phone',
  '_phone_number',
  '_address',
  '_first_name',
  '_last_name',
  '_full_name',
  '_postal_code',
  '_national_id',
  '_birth_date',
  '_card_number',
  '_token',
  '_secret',
  '_key',
  '_password',
  '_cookie',
  '_authorization',
] as const;

/** The only request headers that leave. Never cookie, authorization, x-forwarded-for, x-real-ip or x-vercel-ip-*. */
export const ALLOWED_REQUEST_HEADERS: readonly string[] = [
  'accept',
  'accept-language',
  'content-length',
  'content-type',
  'host',
  'next-action',
  'next-router-prefetch',
  'purpose',
  'referer',
  'rsc',
  'user-agent',
  'x-vercel-id',
];

/** Contexts the SDK fills: device, runtime and trace facts, never walked (only `trace.data` is). */
const SDK_CONTEXTS: ReadonlySet<string> = new Set([
  'trace',
  'otel',
  'runtime',
  'os',
  'device',
  'browser',
  'app',
  'culture',
  'cloud_resource',
  'react',
  'nextjs',
  'flags',
  'profile',
  'replay',
]);

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const V4 = `${OCTET}(?:\\.${OCTET}){3}`;
// A full stop after an address ends the sentence; only `.digit` continues a number.
const IPV4 = new RegExp(`(?<![\\w.])${V4}(?!\\w|\\.\\d)`, 'g');
// IPv6 ending in an IPv4 (`::ffff:203.0.113.9`, the form Node reports for a dual stack peer), whole.
const IPV6_WITH_V4 = new RegExp(`(?<![\\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}${V4}(?!\\w|\\.\\d)`, 'g');
const H = '[0-9A-Fa-f]{1,4}';
// The full eight group form, or any form with `::`. Times (12:30:45) and MAC addresses never match.
const IPV6 = new RegExp(
  `(?<![\\w:])(?:${[
    `(?:${H}:){7}${H}`,
    `(?:${H}:){1,6}:${H}`,
    `(?:${H}:){1,5}(?::${H}){1,2}`,
    `(?:${H}:){1,4}(?::${H}){1,3}`,
    `(?:${H}:){1,3}(?::${H}){1,4}`,
    `(?:${H}:){1,2}(?::${H}){1,5}`,
    `${H}:(?::${H}){1,6}`,
    `(?:${H}:){1,7}:`,
    `:(?::${H}){1,7}`,
  ].join('|')})(?![\\w:])`,
  'g',
);
// Spec 0004's pattern, widened after the 00b reviews: Arabic-Indic and Persian digits (the `ar`
// locale), an opening bracket, and up to two separators in a row (`+90 (555) 123 45 67`). Still
// anchored, so a digit run inside a word, a uuid or a SHA never matches.
const DIGIT = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const PHONE = new RegExp(`(?<![\\w-])\\+?\\(?${DIGIT}(?:[\\s().-]{0,2}${DIGIT}){6,}(?![\\w-])`, 'g');
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>]+/gi;
// A relative URL with a query or a fragment, standing alone (after a space, a quote, a bracket or `=`).
const RELATIVE_URL = /(?<![\w/:.%@-])\/[^\s"'<>?#]*[?#][^\s"'<>]*/g;
// The `[name="value"]` parts of a CSS selector, as in `button[aria-label="Ali Veli"]`.
const SELECTOR_ATTRIBUTES = /\[[^\]]*\]/g;
// `GET /tr/auth/callback?code=…`: the transaction name the Next SDK gives a request.
const METHOD_AND_PATH = /^([A-Z]+ )(\/.*)$/s;

type Obj = Record<string, unknown>;
type Mode = 'data' | 'message';

const MAX_DEPTH = 12;
// Sentry's own normalize keeps 1000 entries per level; the node budget covers a large transaction.
const MAX_BREADTH = 1000;
const MAX_NODES = 50_000;

/** The walk's bounds for one payload: nodes left, and every object already visited. */
type Budget = { nodes: number; seen: WeakSet<object> };

function newBudget(): Budget {
  return { nodes: MAX_NODES, seen: new WeakSet() };
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lowercase, `-` folded to `_`. Plain `toLowerCase()`: never a locale aware fold for an identifier. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll('-', '_');
}

/** camelCase split into words, then lowercase, with `-`, `.` and spaces folded to `_`. */
function foldKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[-.\s]+/g, '_');
}

export function isPersonalKey(key: string): boolean {
  const k = foldKey(key);
  // Spec 0012 AC-11: any key that names a password, wherever the word sits (`password_confirm`, `new_password_2`).
  if (k.includes('password') || k.includes('passwd')) return true;
  return PERSONAL_KEYS.has(k) || PERSONAL_SUFFIXES.some((suffix) => k.endsWith(suffix));
}

/** A URL fragment kept apart from its URL, such as the SDK's `http.fragment` span attribute. */
function isFragmentKey(key: string): boolean {
  const k = normalizeKey(key);
  return k === 'hash' || k === 'fragment' || k.endsWith('.fragment') || k.endsWith('_fragment');
}

function isFilteredKey(key: string): boolean {
  return isPersonalKey(key) || isFragmentKey(key);
}

/** The only query parameters a URL keeps (D85): campaign tags and the page number. */
function isAllowedParam(name: string): boolean {
  const k = normalizeKey(name);
  return k === 'page' || /^utm_[a-z]+$/.test(k);
}

function isUrlKey(key: string): boolean {
  const k = normalizeKey(key);
  return (
    k === 'url' ||
    k === 'href' ||
    k === 'uri' ||
    k === 'from' ||
    k === 'to' ||
    k === 'referer' ||
    k === 'referrer' ||
    k.endsWith('url') ||
    k.endsWith('.full') ||
    k.endsWith('.target') ||
    k.endsWith('.path')
  );
}

function isQueryKey(key: string): boolean {
  const k = normalizeKey(key);
  return k === 'query' || k === 'query_string' || k.endsWith('.query');
}

/** A query string part: `+` is a space there. */
function decode(part: string): string {
  try {
    return decodeURIComponent(part.replaceAll('+', ' '));
  } catch {
    return part;
  }
}

/** A path: `+` is itself there. */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Emails and IP addresses. */
function redactPlain(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(IPV6_WITH_V4, '[ip]')
    .replace(IPV6, '[ip]')
    .replace(IPV4, '[ip]');
}

/** Every URL inside a text, absolute or relative, scrubbed as a URL. */
function scrubUrlsInText(text: string): string {
  return text.replace(ABSOLUTE_URL, (url) => scrubUrl(url)).replace(RELATIVE_URL, (url) => scrubUrl(url));
}

/** User data text: URLs, emails and IP addresses. */
function redactData(text: string): string {
  return redactPlain(scrubUrlsInText(text));
}

/** Message like text: URLs, emails, IPs, and phone numbers. */
export function redactMessage(text: string): string {
  return redactData(text).replace(PHONE, '[phone]');
}

function keepParam(pair: string): boolean {
  if (pair === '') return false;
  const eq = pair.indexOf('=');
  const name = decode(eq === -1 ? pair : pair.slice(0, eq));
  const value = eq === -1 ? '' : decode(pair.slice(eq + 1));
  return isAllowedParam(name) && redactMessage(value) === value;
}

/** Emails and IPs in a path, also when percent encoded (`/u/ali%40x.com`). */
function redactPath(path: string): string {
  const redacted = redactPlain(path);
  const decoded = decodePath(redacted);
  const decodedRedacted = redactPlain(decoded);
  return decodedRedacted === decoded ? redacted : decodedRedacted;
}

// `scheme://` and the authority of an absolute URL: everything up to the path, query or fragment.
const SCHEME_AND_AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i;

// A Storage object route: `/storage/v1/object/`, any route words (`sign`, `public`, `authenticated`,
// `upload/sign`, `info`, `list`), then the bucket. Everything after the bucket is an object name, which
// holds a provider id and a document type (spec 0006 AC-24), so it goes.
const ROUTE_WORD = '(?:sign|public|authenticated|upload|info|list|render|image)';
const STORAGE_OBJECT = new RegExp(
  `^(.*?\\/storage\\/v1\\/object\\/(?:${ROUTE_WORD}\\/)*(?!${ROUTE_WORD}(?:\\/|$))[^/]+)\\/.*$`,
  's',
);

/** Cuts a Storage object URL after its bucket; any other path is returned as it was. */
function cutStoragePath(path: string): string {
  const match = STORAGE_OBJECT.exec(path);
  return match ? (match[1] ?? path) : path;
}

/**
 * Keeps only the allowed parameters (D85), drops every fragment and any credentials, and redacts
 * emails and IPs in the path. A Storage object URL is cut after its bucket, with no parameter. The host stays as it is: it is our server, even when it is an IP address
 * (local, e2e). Absolute or relative. `&` and `;` both separate parameters.
 */
const FAKE_CHECKOUT_PATH = /(\/dev\/fake-checkout\/)[^/?#]+/g;

export function scrubUrl(url: string): string {
  const withoutFragment = url.split('#', 1)[0] ?? '';
  const authority = SCHEME_AND_AUTHORITY.exec(withoutFragment);
  const [prefix = '', scheme = '', hostPart = ''] = authority ?? [];
  // `user:password@host` loses everything before the host.
  const origin = authority ? `${scheme}${hostPart.slice(hostPart.lastIndexOf('@') + 1)}` : '';
  const rest = withoutFragment.slice(prefix.length);
  const q = rest.indexOf('?');
  // The fake card page's path carries its checkout token (spec 0011-08, security review S7).
  const rawPath = (q === -1 ? rest : rest.slice(0, q)).replace(FAKE_CHECKOUT_PATH, '$1[token]');
  const storagePath = cutStoragePath(rawPath);
  // A Storage URL keeps no parameter at all: a signed link's token is its key.
  if (storagePath !== rawPath || /\/storage\/v1\/object\//.test(rawPath)) {
    return origin + redactPath(storagePath);
  }
  const path = origin + redactPath(rawPath);
  if (q === -1) return path;
  const kept = rest
    .slice(q + 1)
    .split(/[&;]/)
    .filter(keepParam);
  return kept.length > 0 ? `${path}?${kept.join('&')}` : path;
}

function scrubQueryString(query: string): string {
  return scrubUrl(`?${query.replace(/^\?/, '')}`).slice(1);
}

/** `/tr/x?…` or `GET /tr/x?…`; any other name is left to the SDK. */
function scrubTransactionName(name: string): string {
  if (name.startsWith('/')) return scrubUrl(name);
  const match = METHOD_AND_PATH.exec(name);
  return match ? `${match[1]}${scrubUrl(match[2] ?? '')}` : name;
}

function walk(value: unknown, mode: Mode, budget: Budget, depth: number, key?: string): unknown {
  budget.nodes -= 1;
  if (depth > MAX_DEPTH || budget.nodes < 0) return FILTERED;
  if (typeof value === 'string') {
    if (key !== undefined && isQueryKey(key)) return scrubQueryString(value);
    if ((key !== undefined && isUrlKey(key)) || /^https?:\/\//i.test(value)) return scrubUrl(value);
    return mode === 'message' ? redactMessage(value) : redactData(value);
  }
  if (typeof value !== 'object' || value === null) return value;
  // A cycle, or an object already sent once in this payload.
  if (budget.seen.has(value)) return FILTERED;
  budget.seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_BREADTH).map((item) => walk(item, mode, budget, depth + 1));
    if (value.length > MAX_BREADTH) items.push(FILTERED);
    return items;
  }
  const out: Obj = {};
  let count = 0;
  for (const k of Object.keys(value)) {
    if (count === MAX_BREADTH) {
      out[FILTERED] = FILTERED;
      break;
    }
    count += 1;
    out[k] = isFilteredKey(k) ? FILTERED : walk((value as Obj)[k], mode, budget, depth + 1, k);
  }
  return out;
}

/** Span and log attributes: `sentry.*` belongs to the SDK, except the message template and its parameters. */
function scrubAttributes(attributes: Obj, budget: Budget): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (k.startsWith('sentry.message.')) out[k] = walk(v, 'message', budget, 1);
    else if (k.startsWith('sentry.')) out[k] = v;
    else out[k] = isFilteredKey(k) ? FILTERED : walk(v, 'data', budget, 1, k);
  }
  return out;
}

function scrubHeaders(headers: Obj): Obj {
  const out: Obj = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!ALLOWED_REQUEST_HEADERS.includes(lower) || typeof value !== 'string') continue;
    out[name] = lower === 'referer' ? scrubUrl(value) : value.replace(EMAIL, '[email]');
  }
  return out;
}

function scrubQueryValue(query: unknown): unknown {
  if (typeof query === 'string') return scrubQueryString(query);
  if (Array.isArray(query)) {
    return query.filter(
      (pair) =>
        Array.isArray(pair) &&
        typeof pair[0] === 'string' &&
        keepParam(`${encodeURIComponent(pair[0])}=${encodeURIComponent(String(pair[1] ?? ''))}`),
    );
  }
  if (isObj(query)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(query)) {
      if (keepParam(`${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ''))}`)) out[k] = v;
    }
    return out;
  }
  return undefined;
}

/** method, url, query string and allow listed headers. Cookies, bodies and env never leave. */
function scrubRequest(request: Obj): Obj {
  const out: Obj = {};
  if (typeof request.method === 'string') out.method = request.method;
  if (typeof request.url === 'string') out.url = scrubUrl(request.url);
  if (request.query_string !== undefined) out.query_string = scrubQueryValue(request.query_string);
  if (isObj(request.headers)) out.headers = scrubHeaders(request.headers);
  return out;
}

function scrubContexts(contexts: Obj, budget: Budget): Obj {
  const out: Obj = {};
  for (const [name, context] of Object.entries(contexts)) {
    if (name === 'trace' && isObj(context)) {
      out[name] = isObj(context.data) ? { ...context, data: scrubAttributes(context.data, budget) } : context;
    } else if (SDK_CONTEXTS.has(name)) {
      out[name] = context;
    } else {
      out[name] = isFilteredKey(name) ? FILTERED : walk(context, 'data', budget, 1);
    }
  }
  return out;
}

/** A `ui.*` breadcrumb or span names an element by a CSS selector: its attribute values are user text. */
function withoutSelectorAttributes(text: string): string {
  return text.replace(SELECTOR_ATTRIBUTES, '');
}

function scrubCrumb(crumb: Obj, budget: Budget): Obj {
  const out: Obj = { ...crumb };
  const ui = typeof crumb.category === 'string' && crumb.category.startsWith('ui.');
  if (typeof crumb.message === 'string') {
    out.message = redactMessage(ui ? withoutSelectorAttributes(crumb.message) : crumb.message);
  }
  if (crumb.data !== undefined)
    out.data = walk(crumb.data, crumb.category === 'console' ? 'message' : 'data', budget, 1);
  return out;
}

function scrubSpanFields(span: Obj, budget: Budget): Obj {
  const out: Obj = { ...span };
  const ui = typeof span.op === 'string' && span.op.startsWith('ui.');
  if (typeof span.description === 'string') {
    out.description = redactData(ui ? withoutSelectorAttributes(span.description) : span.description);
  }
  if (isObj(span.data)) out.data = scrubAttributes(span.data, budget);
  return out;
}

function scrubFrame(frame: unknown): unknown {
  if (!isObj(frame)) return frame;
  // Local variables are user data; the SDK only adds them when asked, and we never ask.
  const { vars: _vars, ...out } = frame;
  // A stackless browser error gets the page URL, query and fragment included, as its frame's file.
  for (const key of ['filename', 'abs_path'] as const) {
    const path = out[key];
    if (typeof path === 'string' && /^https?:\/\//i.test(path)) out[key] = scrubUrl(path);
  }
  return out;
}

function scrubException(exception: Obj): Obj {
  if (!Array.isArray(exception.values)) return exception;
  return {
    ...exception,
    values: exception.values.map((value: unknown) => {
      if (!isObj(value)) return value;
      const out: Obj = { ...value };
      if (typeof value.value === 'string') out.value = redactMessage(value.value);
      if (isObj(value.stacktrace) && Array.isArray(value.stacktrace.frames)) {
        out.stacktrace = { ...value.stacktrace, frames: value.stacktrace.frames.map(scrubFrame) };
      }
      return out;
    }),
  };
}

function scrubEventFields(event: Obj, budget: Budget): Obj {
  const out: Obj = { ...event };
  delete out.user;
  if (isObj(event.request)) out.request = scrubRequest(event.request);
  if (event.extra !== undefined) out.extra = walk(event.extra, 'data', budget, 0);
  if (isObj(event.contexts)) out.contexts = scrubContexts(event.contexts, budget);
  if (typeof event.message === 'string') out.message = redactMessage(event.message);
  if (isObj(event.logentry)) {
    const { message, params } = event.logentry;
    out.logentry = {
      ...event.logentry,
      ...(typeof message === 'string' ? { message: redactMessage(message) } : {}),
      ...(params !== undefined ? { params: walk(params, 'message', budget, 1) } : {}),
    };
  }
  if (isObj(event.exception)) out.exception = scrubException(event.exception);
  if (Array.isArray(event.breadcrumbs)) {
    out.breadcrumbs = event.breadcrumbs.map((crumb: unknown) =>
      isObj(crumb) ? scrubCrumb(crumb, budget) : crumb,
    );
  }
  if (Array.isArray(event.spans)) {
    out.spans = event.spans.map((span: unknown) => (isObj(span) ? scrubSpanFields(span, budget) : span));
  }
  if (typeof event.transaction === 'string') out.transaction = scrubTransactionName(event.transaction);
  if (event.type === 'replay_event' && Array.isArray(event.urls)) {
    out.urls = event.urls.map((url: unknown) => (typeof url === 'string' ? scrubUrl(url) : url));
  }
  return out;
}

function failClosed<T>(scrub: () => T): T | null {
  try {
    return scrub();
  } catch {
    return null;
  }
}

/** An error, transaction or replay event. Returns null when it cannot be scrubbed: the caller drops it. */
export function scrubEvent<T extends object>(event: T): T | null {
  return failClosed(() => scrubEventFields(event as Obj, newBudget()) as T);
}

export function scrubBreadcrumb<T extends object>(breadcrumb: T): T | null {
  return failClosed(() => scrubCrumb(breadcrumb as Obj, newBudget()) as T);
}

const SPAN_IDS = [
  'span_id',
  'trace_id',
  'parent_span_id',
  'segment_id',
  'start_timestamp',
  'timestamp',
  'op',
  'origin',
  'status',
  'is_segment',
] as const;

/** A span's ids and timing, each read on its own so one hostile field cannot take the rest down. */
function spanIdsOnly(span: Obj): Obj {
  const out: Obj = { description: FILTERED, data: {} };
  for (const key of SPAN_IDS) {
    try {
      if (span[key] !== undefined) out[key] = span[key];
    } catch {
      // A field that cannot be read stays out.
    }
  }
  return out;
}

/**
 * A span sent on its own (`beforeSendSpan`), such as a standalone INP span named after the element
 * clicked. Sentry cannot drop a span here, so a span that cannot be scrubbed keeps only its ids.
 */
export function scrubSpan<T extends object>(span: T): T {
  return (failClosed(() => scrubSpanFields(span as Obj, newBudget())) ?? spanIdsOnly(span as Obj)) as T;
}

/** A Sentry Logs record: the message is message like, the attributes are user data. */
export function scrubLog<T extends object>(log: T): T | null {
  return failClosed(() => {
    const record = log as Obj;
    const out: Obj = { ...record };
    if (typeof record.message === 'string') out.message = redactMessage(record.message);
    if (isObj(record.attributes)) out.attributes = scrubAttributes(record.attributes, newBudget());
    return out as T;
  });
}

// The URL fields of a CSP report, from `report-uri` (kebab case) and the Reporting API (camel case).
const CSP_URL_KEYS: ReadonlySet<string> = new Set([
  'document-uri',
  'referrer',
  'blocked-uri',
  'source-file',
  'url',
  'documenturl',
  'blockedurl',
  'sourcefile',
]);
const CSP_SAMPLE_KEYS: ReadonlySet<string> = new Set(['script-sample', 'sample']);

function scrubCspValue(value: unknown, budget: Budget, depth: number, key?: string): unknown {
  budget.nodes -= 1;
  if (depth > MAX_DEPTH || budget.nodes < 0) return FILTERED;
  if (typeof value === 'string') {
    const k = key?.toLowerCase();
    // `inline`, `eval`, `data` and extension schemes are not URLs of ours: they stay as they are.
    if (k !== undefined && CSP_URL_KEYS.has(k))
      return /^(?:https?:)?\//i.test(value) ? scrubUrl(value) : value;
    if (k !== undefined && CSP_SAMPLE_KEYS.has(k)) return redactMessage(value);
    return redactData(value);
  }
  if (Array.isArray(value))
    return value.slice(0, MAX_BREADTH).map((item) => scrubCspValue(item, budget, depth + 1));
  if (isObj(value)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubCspValue(v, budget, depth + 1, k);
    return out;
  }
  return value;
}

/**
 * A CSP violation report, from `report-uri` or the Reporting API (D83): every URL in it scrubbed (the
 * document, the referrer, the blocked resource, the source file) and the script sample redacted.
 */
export function scrubCspReport(report: unknown): unknown {
  return failClosed(() => scrubCspValue(report, newBudget(), 0));
}

/** One rrweb event inside a replay recording: the page URL, and breadcrumbs and spans recorded into it. */
export function scrubRecordingEvent<T extends object>(recordingEvent: T): T | null {
  return failClosed(() => {
    const event = recordingEvent as Obj;
    if (!isObj(event.data)) return recordingEvent;
    const data = event.data;
    if (event.type === 4 && typeof data.href === 'string') {
      return { ...event, data: { ...data, href: scrubUrl(data.href) } } as T;
    }
    if (event.type === 5 && isObj(data.payload)) {
      const payload = data.payload;
      const budget = newBudget();
      if (data.tag === 'breadcrumb')
        return { ...event, data: { ...data, payload: scrubCrumb(payload, budget) } } as T;
      if (data.tag === 'performanceSpan')
        return { ...event, data: { ...data, payload: scrubSpanFields(payload, budget) } } as T;
      return { ...event, data: { ...data, payload: walk(payload, 'data', budget, 1) } } as T;
    }
    return recordingEvent;
  });
}
