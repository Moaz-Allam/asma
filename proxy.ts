import createIntlProxy from 'next-intl/middleware';
import { NextRequest, type NextResponse } from 'next/server';

import { getEnv } from '@/lib/env';
import { routing } from '@/lib/i18n/routing';
import { buildCsp, cspReportUri, reportingEndpoints } from '@/lib/security/csp';

/**
 * ⚠️ This file MUST be named `proxy.ts` and export `proxy`.
 *
 * Next.js 16 renamed the old `middleware.ts` convention. A leftover
 * `middleware.ts` is SILENTLY IGNORED — no error, no warning — and any route
 * protection written there simply never runs. Rule 11.
 *
 * ⛔ This is a ROUTING AND UX layer, never a security boundary.
 *    Authorisation lives in `requireRole()` inside EVERY Server Action and Route
 *    Handler, independently. There are no "already protected by proxy" shortcuts.
 *    Next.js itself now recommends against relying on this layer for auth.
 *
 * Two jobs: negotiate the locale and redirect accordingly, and give every page response an enforced
 * Content Security Policy with a fresh nonce (spec 0004 AC-13). The nonce reaches Next through the
 * request headers (Next reads it from the request's policy and stamps its own scripts with it), and the
 * same policy goes on the response. Feature 02 adds an unauthenticated-user redirect here for UX — and
 * the real check in the actions themselves.
 */

const intlProxy = createIntlProxy(routing);

/**
 * The Supabase origin for connect-src. Never throws (AC-13): a broken environment already stops the
 * boot in instrumentation.ts, and if one ever slips past, the policy only gets stricter ('self').
 */
function supabaseUrl(): string {
  try {
    return getEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return '';
  }
}

export function proxy(request: NextRequest): NextResponse {
  // A random one time token per request, base64 as CSP nonces are written.
  const nonce = btoa(crypto.randomUUID());
  const reportUri = cspReportUri(request.nextUrl.origin);
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === 'development',
    supabaseUrl: supabaseUrl(),
    reportUri,
  });

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  // next-intl forwards these request headers to the page. Only the URL, method and headers are carried
  // over: the body stays with the original request.
  const response = intlProxy(new NextRequest(request.url, { headers, method: request.method }));

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Reporting-Endpoints', reportingEndpoints(reportUri));
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except Next internals, the API surface, and static files. `api` is deliberately
      // excluded: machine endpoints (/api/health, /api/e, /api/a, /api/csp) are not localized.
      source: '/((?!api|_next|_vercel|.*\\..*).*)',
      // Prefetches render no document, so they need no nonce (and no locale negotiation).
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
