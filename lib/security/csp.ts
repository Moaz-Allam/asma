import { parseEuSentryDsn } from '@/lib/deployment';

/**
 * The Content Security Policy, built per request in proxy.ts with a fresh nonce (spec 0004 AC-13, D69).
 * Exactly the directives of the spec's CSP table; each later position adds its own sources here
 * (Turnstile in 01, Supabase storage images in 02, the iyzico redirect in 09).
 *
 * Never throws: a missing or malformed DSN leaves out only the report directives, and a malformed
 * Supabase URL leaves connect-src at 'self'. It parses the DSN itself, without the Sentry SDK.
 */

export type CspOptions = {
  /** Development adds 'unsafe-eval' for the dev overlay; production never has it. */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL: its origin joins connect-src, with ws or wss to match the scheme. */
  supabaseUrl: string;
  /** The Sentry security endpoint, or none. */
  reportUri?: string;
};

/** The reporting group named by `report-to`, declared in the Reporting-Endpoints response header. */
export const REPORT_GROUP = 'csp-endpoint';

function supabaseSources(supabaseUrl: string): string[] {
  try {
    const url = new URL(supabaseUrl);
    const socket = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return [url.origin, `${socket}//${url.host}`];
  } catch {
    return [];
  }
}

export function buildCsp(nonce: string, { dev, supabaseUrl, reportUri }: CspOptions): string {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    // 'strict-dynamic' passes the nonce's trust to scripts those scripts load (Next's chunks, PostHog's
    // lazy bundles); host allow lists are ignored by browsers that support it.
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    // Style attributes need 'unsafe-inline', and a nonce here would cancel it, so there is none.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'blob:', 'data:']],
    // next/font serves the fonts from our own origin.
    ['font-src', ["'self'"]],
    // Sentry's tunnel and PostHog's proxy are same origin (/api/e, /api/a).
    ['connect-src', ["'self'", ...supabaseSources(supabaseUrl)]],
    // Sentry Replay compresses in a worker started from a blob.
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
  if (reportUri) directives.push(['report-uri', [reportUri]], ['report-to', [REPORT_GROUP]]);
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** The Sentry security endpoint for violation reports, derived from an EU DSN; none for anything else. */
export function cspReportUri(dsn: string | undefined): string | undefined {
  const parts = dsn ? parseEuSentryDsn(dsn) : null;
  if (parts === null) return undefined;
  return `https://${parts.host}/api/${parts.projectId}/security/?sentry_key=${parts.publicKey}`;
}

/** The Reporting-Endpoints header value that names the `report-to` group. */
export function reportingEndpoints(reportUri: string): string {
  return `${REPORT_GROUP}="${reportUri}"`;
}
