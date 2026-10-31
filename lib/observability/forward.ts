import 'server-only';

import { parseEuSentryDsn } from '@/lib/deployment';
import { readCapped } from '@/lib/http/body';
import { scrubCspReport } from '@/lib/observability/scrub';

/**
 * The Sentry relays (spec 0004 AC-2, AC-3, AC-13; D83): POST /api/e carries the browser SDK's envelopes
 * and POST /api/csp the browser's Content Security Policy violation reports. Each forwards only to the
 * EU ingest host of our own DSN and never forwards a visitor's header beyond the content type (and, for
 * a CSP report, the user agent Sentry's inbound filters read), so no cookie, referer, authorization or
 * visitor IP reaches Sentry. A CSP report is scrubbed like every other signal before it leaves.
 *
 * Public machine endpoints: browsers post here without a session, so there is no requireRole() (D71,
 * D83). Every relay answers without throwing; a lost report is only a lost report.
 */

/** Under Vercel's 4.5 MB function body limit; a replay segment is far smaller. */
export const ENVELOPE_LIMIT_BYTES = 4 * 1024 * 1024;
export const CSP_REPORT_LIMIT_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 5000;
/** The response headers the SDK reads to back off. */
const RELAYED_HEADERS = ['content-type', 'retry-after', 'x-sentry-rate-limits'] as const;
const CSP_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/csp-report',
  'application/reports+json',
  'application/json',
]);

export type EnvelopeForwarderOptions = {
  /** Read per request, so importing a route at build time never reads the environment. */
  dsn: () => string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type CspReportForwarderOptions = EnvelopeForwarderOptions & {
  /** The environment and release a report is filed under, as for every other event. */
  environment: () => string;
  release: () => string;
};

type DsnParts = NonNullable<ReturnType<typeof parseEuSentryDsn>>;

function ourDsn(dsn: string | undefined): DsnParts | null {
  return dsn ? parseEuSentryDsn(dsn) : null;
}

function sameDsn(a: DsnParts, b: DsnParts): boolean {
  return a.host === b.host && a.projectId === b.projectId && a.publicKey === b.publicKey;
}

/** The DSN in an envelope's first line, which the browser SDK writes there when it sends through a tunnel. */
function envelopeDsn(body: Uint8Array): DsnParts | null {
  const end = body.indexOf(0x0a);
  try {
    const header: unknown = JSON.parse(new TextDecoder().decode(end === -1 ? body : body.subarray(0, end)));
    if (typeof header !== 'object' || header === null || !('dsn' in header)) return null;
    return typeof header.dsn === 'string' ? parseEuSentryDsn(header.dsn) : null;
  } catch {
    return null;
  }
}

function relayed(upstream: Response, body: string): Response {
  const headers = new Headers();
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(body, { status: upstream.status, headers });
}

/** POST /api/e: an envelope for our own project only, to its fixed EU ingest URL. */
export function createEnvelopeForwarder(
  options: EnvelopeForwarderOptions,
): (request: Request) => Promise<Response> {
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  return async (request) => {
    const ours = ourDsn(options.dsn());
    if (ours === null) return new Response(null, { status: 404 });
    const body = await readCapped(request, ENVELOPE_LIMIT_BYTES);
    if (body === null) return new Response(null, { status: 413 });
    const theirs = envelopeDsn(body);
    if (theirs === null || !sameDsn(ours, theirs)) return new Response(null, { status: 403 });
    try {
      const upstream = await send(`https://${ours.host}/api/${ours.projectId}/envelope/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return relayed(upstream, await upstream.text());
    } catch {
      return new Response(null, { status: 502 });
    }
  };
}

/** POST /api/csp: a violation report, scrubbed, to our project's security endpoint. Always 204. */
export function createCspReportForwarder(
  options: CspReportForwarderOptions,
): (request: Request) => Promise<Response> {
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  return async (request) => {
    const contentType =
      (request.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (!CSP_CONTENT_TYPES.has(contentType)) return new Response(null, { status: 415 });
    const ours = ourDsn(options.dsn());
    // Without a DSN there is nowhere to send it: accepted and dropped, as a browser expects.
    if (ours === null) return new Response(null, { status: 204 });
    const body = await readCapped(request, CSP_REPORT_LIMIT_BYTES);
    if (body === null) return new Response(null, { status: 413 });

    let report: unknown;
    try {
      report = scrubCspReport(JSON.parse(new TextDecoder().decode(body)));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (report === null) return new Response(null, { status: 400 });

    const target = new URL(`https://${ours.host}/api/${ours.projectId}/security/`);
    target.searchParams.set('sentry_key', ours.publicKey);
    target.searchParams.set('sentry_environment', options.environment());
    target.searchParams.set('sentry_release', options.release());
    const userAgent = request.headers.get('user-agent');
    try {
      await send(target, {
        method: 'POST',
        headers: { 'content-type': contentType, ...(userAgent ? { 'user-agent': userAgent } : {}) },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // A report that cannot be delivered is dropped; the browser never retries one anyway.
    }
    return new Response(null, { status: 204 });
  };
}
