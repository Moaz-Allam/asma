/**
 * The one scrubber. Spec 0004 AC-3 and its key invariants: personal data never leaves.
 *
 * It walks USER DATA fields only (event `extra`, `request`, breadcrumb `data`, log attributes, span
 * attributes, user defined `contexts`, replay URLs) and never the fields the SDK owns (ids, release,
 * environment, sdk, tags, fingerprint, the trace and device contexts), so grouping and trace joins
 * keep working. Inside user data:
 *   - a value under a personal key is replaced by FILTERED (the key stays, so the shape is visible);
 *   - URLs lose their sensitive parameters and every fragment;
 *   - email addresses and IPv4/IPv6 addresses are redacted anywhere;
 *   - phone numbers are redacted in message like fields only (messages, exception values, console
 *     arguments, log templates), with the anchored pattern below, so trace ids, uuids and commit SHAs
 *     survive everywhere.
 * `request` is reduced to method, url, query string and allow listed headers; `user` is never sent.
 * Every exported function fails closed: if scrubbing throws, it returns null and the caller drops the
 * payload. No SDK import here, so the browser, the server, logs and replays share exactly one copy.
 */

export const FILTERED = '[Filtered]';

const PERSONAL_KEYS: ReadonlySet<string> = new Set([
  'name',
  'first_name',
  'last_name',
  'full_name',
  'email',
  'phone',
  'phone_number',
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
  'description',
  'message',
  'body',
  'comment',
  'national_id',
  'tckn',
  'identity_number',
  'passport',
  'tax_id',
  'tax_number',
  'birth_date',
  'date_of_birth',
  'dob',
]);
const PERSONAL_SUFFIXES = ['_email', '_phone', '_address', '_token', '_secret', '_key', '_password'] as const;

const SENSITIVE_URL_PARAMS: ReadonlySet<string> = new Set([
  'token',
  'access_token',
  'refresh_token',
  'token_hash',
  'code',
  'email',
  'phone',
  'q',
  'ref',
  'customer',
]);

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
  'feedback',
  'state',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IPV4 =
  /(?<![\w.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\w.])/g;
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
// Spec 0004, verbatim: anchored so a digit run inside a word, a uuid or a SHA never matches.
const PHONE = /(?<![\w-])\+?\d(?:[\s().-]?\d){6,}(?![\w-])/g;
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>]+/gi;

type Obj = Record<string, unknown>;
type Mode = 'data' | 'message';

const MAX_DEPTH = 12;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lowercase, `-` folded to `_`. Plain `toLowerCase()`: never a locale aware fold for an identifier. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll('-', '_');
}

export function isPersonalKey(key: string): boolean {
  const k = normalizeKey(key);
  return PERSONAL_KEYS.has(k) || PERSONAL_SUFFIXES.some((suffix) => k.endsWith(suffix));
}

function isSensitiveParam(name: string): boolean {
  return SENSITIVE_URL_PARAMS.has(normalizeKey(name)) || isPersonalKey(name);
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

function decode(part: string): string {
  try {
    return decodeURIComponent(part.replaceAll('+', ' '));
  } catch {
    return part;
  }
}

/** Emails and IP addresses, anywhere in a user data string. */
function redactData(text: string): string {
  return text.replace(EMAIL, '[email]').replace(IPV6, '[ip]').replace(IPV4, '[ip]');
}

/** Message like text: emails, IPs, and phone numbers. */
export function redactMessage(text: string): string {
  return redactData(text).replace(PHONE, '[phone]');
}

function keepParam(pair: string): boolean {
  if (pair === '') return false;
  const eq = pair.indexOf('=');
  const name = decode(eq === -1 ? pair : pair.slice(0, eq));
  const value = eq === -1 ? '' : decode(pair.slice(eq + 1));
  return !isSensitiveParam(name) && redactMessage(value) === value;
}

// `scheme://` and the authority of an absolute URL: everything up to the path, query or fragment.
const SCHEME_AND_AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i;

/**
 * Drops every fragment, any credentials, and the sensitive parameters, and redacts emails and IPs in
 * the path. The host stays as it is: it is our server, even when it is an IP address (local, e2e).
 * Absolute or relative.
 */
export function scrubUrl(url: string): string {
  const withoutFragment = url.split('#', 1)[0] ?? '';
  const authority = SCHEME_AND_AUTHORITY.exec(withoutFragment);
  const [prefix = '', scheme = '', hostPart = ''] = authority ?? [];
  // `user:password@host` loses everything before the host.
  const origin = authority ? `${scheme}${hostPart.slice(hostPart.lastIndexOf('@') + 1)}` : '';
  const rest = withoutFragment.slice(prefix.length);
  const q = rest.indexOf('?');
  const path = origin + redactData(q === -1 ? rest : rest.slice(0, q));
  if (q === -1) return path;
  const kept = rest
    .slice(q + 1)
    .split('&')
    .filter(keepParam);
  return kept.length > 0 ? `${path}?${kept.join('&')}` : path;
}

function scrubQueryString(query: string): string {
  return scrubUrl(`?${query.replace(/^\?/, '')}`).slice(1);
}

function scrubUrlsInText(text: string): string {
  return redactData(text.replace(ABSOLUTE_URL, (url) => scrubUrl(url)));
}

function walk(value: unknown, mode: Mode, depth: number, key?: string): unknown {
  if (depth > MAX_DEPTH) return FILTERED;
  if (typeof value === 'string') {
    if (key !== undefined && isQueryKey(key)) return scrubQueryString(value);
    if ((key !== undefined && isUrlKey(key)) || /^https?:\/\//i.test(value)) return scrubUrl(value);
    return mode === 'message' ? redactMessage(value) : redactData(value);
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, mode, depth + 1));
  if (isObj(value)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value))
      out[k] = isPersonalKey(k) ? FILTERED : walk(v, mode, depth + 1, k);
    return out;
  }
  return value;
}

/** Span and log attributes: `sentry.*` belongs to the SDK, except the message template and its parameters. */
function scrubAttributes(attributes: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (k.startsWith('sentry.message.')) out[k] = walk(v, 'message', 1);
    else if (k.startsWith('sentry.')) out[k] = v;
    else out[k] = isPersonalKey(k) ? FILTERED : walk(v, 'data', 1, k);
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

function scrubContexts(contexts: Obj): Obj {
  const out: Obj = {};
  for (const [name, context] of Object.entries(contexts)) {
    if (name === 'trace' && isObj(context)) {
      out[name] = isObj(context.data) ? { ...context, data: scrubAttributes(context.data) } : context;
    } else if (SDK_CONTEXTS.has(name)) {
      out[name] = context;
    } else {
      out[name] = isPersonalKey(name) ? FILTERED : walk(context, 'data', 1);
    }
  }
  return out;
}

function scrubCrumb(crumb: Obj): Obj {
  const out: Obj = { ...crumb };
  if (typeof crumb.message === 'string') out.message = redactMessage(crumb.message);
  if (crumb.data !== undefined)
    out.data = walk(crumb.data, crumb.category === 'console' ? 'message' : 'data', 1);
  return out;
}

function scrubSpan(span: Obj): Obj {
  const out: Obj = { ...span };
  if (typeof span.description === 'string') out.description = scrubUrlsInText(span.description);
  if (isObj(span.data)) out.data = scrubAttributes(span.data);
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
      // Local variables are user data; the SDK only adds them when asked, and we never ask.
      if (isObj(value.stacktrace) && Array.isArray(value.stacktrace.frames)) {
        out.stacktrace = {
          ...value.stacktrace,
          frames: value.stacktrace.frames.map((frame: unknown) => {
            if (!isObj(frame) || !('vars' in frame)) return frame;
            const { vars: _vars, ...rest } = frame;
            return rest;
          }),
        };
      }
      return out;
    }),
  };
}

function scrubEventFields(event: Obj): Obj {
  const out: Obj = { ...event };
  delete out.user;
  if (isObj(event.request)) out.request = scrubRequest(event.request);
  if (event.extra !== undefined) out.extra = walk(event.extra, 'data', 0);
  if (isObj(event.contexts)) out.contexts = scrubContexts(event.contexts);
  if (typeof event.message === 'string') out.message = redactMessage(event.message);
  if (isObj(event.logentry)) {
    const { message, params } = event.logentry;
    out.logentry = {
      ...event.logentry,
      ...(typeof message === 'string' ? { message: redactMessage(message) } : {}),
      ...(params !== undefined ? { params: walk(params, 'message', 1) } : {}),
    };
  }
  if (isObj(event.exception)) out.exception = scrubException(event.exception);
  if (Array.isArray(event.breadcrumbs)) {
    out.breadcrumbs = event.breadcrumbs.map((crumb: unknown) => (isObj(crumb) ? scrubCrumb(crumb) : crumb));
  }
  if (Array.isArray(event.spans)) {
    out.spans = event.spans.map((span: unknown) => (isObj(span) ? scrubSpan(span) : span));
  }
  if (typeof event.transaction === 'string' && event.transaction.startsWith('/')) {
    out.transaction = scrubUrl(event.transaction);
  }
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
  return failClosed(() => scrubEventFields(event as Obj) as T);
}

export function scrubBreadcrumb<T extends object>(breadcrumb: T): T | null {
  return failClosed(() => scrubCrumb(breadcrumb as Obj) as T);
}

/** A Sentry Logs record: the message is message like, the attributes are user data. */
export function scrubLog<T extends object>(log: T): T | null {
  return failClosed(() => {
    const record = log as Obj;
    const out: Obj = { ...record };
    if (typeof record.message === 'string') out.message = redactMessage(record.message);
    if (isObj(record.attributes)) out.attributes = scrubAttributes(record.attributes);
    return out as T;
  });
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
      if (data.tag === 'breadcrumb')
        return { ...event, data: { ...data, payload: scrubCrumb(payload) } } as T;
      if (data.tag === 'performanceSpan')
        return { ...event, data: { ...data, payload: scrubSpan(payload) } } as T;
      return { ...event, data: { ...data, payload: walk(payload, 'data', 1) } } as T;
    }
    return recordingEvent;
  });
}
