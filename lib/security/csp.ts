/**
 * The Content Security Policy, built per request in proxy.ts with a fresh nonce (spec 0004 AC-13, D69).
 * Exactly the directives of the spec's CSP table; each later position adds its own sources here
 * (Turnstile in 01, Supabase storage images in 02, the iyzico redirect in 09).
 *
 * Never throws: a malformed Supabase URL leaves connect-src at 'self'. Violation reports go to our own
 * /api/csp handler, which scrubs them before they reach Sentry (D83), never straight to Sentry.
 */

export type CspOptions = {
  /** Development adds 'unsafe-eval' for the dev overlay; production never has it. */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL: its origin joins connect-src, with ws or wss to match the scheme. */
  supabaseUrl: string;
  /** Where violation reports go (`cspReportUri()`), or none. */
  reportUri?: string;
};

/** The reporting group named by `report-to`, declared in the Reporting-Endpoints response header. */
export const REPORT_GROUP = 'csp-endpoint';

/** Our own report handler (app/api/csp, D83). */
export const CSP_REPORT_PATH = '/api/csp';

/** Where the Turnstile script and widget live (spec 0005 AC-23). */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

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
    // Sentry's tunnel and PostHog's relay are same origin (/api/e, /api/a).
    ['connect-src', ["'self'", ...supabaseSources(supabaseUrl)]],
    // Sentry Replay compresses in a worker started from a blob.
    ['worker-src', ["'self'", 'blob:']],
    // The Turnstile widget is an iframe (spec 0005 AC-23). Its script carries the page nonce.
    ['frame-src', [TURNSTILE_ORIGIN]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
  if (reportUri) directives.push(['report-uri', [reportUri]], ['report-to', [REPORT_GROUP]]);
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** The absolute URL of our report handler for a page on `origin`; the Reporting API wants it absolute. */
export function cspReportUri(origin: string): string {
  return `${origin}${CSP_REPORT_PATH}`;
}

/** The Reporting-Endpoints header value that names the `report-to` group. */
export function reportingEndpoints(reportUri: string): string {
  return `${REPORT_GROUP}="${reportUri}"`;
}
