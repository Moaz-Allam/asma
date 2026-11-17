import createIntlProxy from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';

import { refreshSession } from '@/lib/db/proxy';
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
 * Three jobs: negotiate the locale and redirect accordingly, give every page response an enforced
 * Content Security Policy with a fresh nonce (spec 0004 AC-13), and keep the session fresh, sending a
 * GET page request with no session to the login (spec 0005 AC-11). The nonce reaches Next through the
 * request headers (Next reads it from the request's policy and stamps its own scripts with it), and the
 * same policy goes on the response, whichever response that turns out to be. The real checks are
 * `guardPage` in every page and `guardedAction` in every action. A Server Action POST always passes
 * through here, so it answers `unauthorized` itself.
 */

const intlProxy = createIntlProxy(routing);

// A locale, then one of the sections only a signed in user may open. The rest of the path is free.
const PRIVATE_PAGE = new RegExp(
  `^/(${routing.locales.join('|')})(/(?:requests|provider|admin|account|continue|onboarding|pay|receipts)(?:/.*)?)$`,
);

/** Where a GET with no session goes, or null when the page is public or the locale is still to come. */
function loginRedirect(request: NextRequest): URL | null {
  if (request.method !== 'GET') return null;
  const match = PRIVATE_PAGE.exec(request.nextUrl.pathname);
  if (!match) return null;
  const [, locale, path] = match;
  const url = new URL(`/${locale}/login`, request.url);
  url.searchParams.set('next', `${path}${request.nextUrl.search}`);
  return url;
}

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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // First, so the render below sees refreshed cookies in the headers copied from this request.
  const session = await refreshSession(request);

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
  const login = session.state === 'signed_out' ? loginRedirect(request) : null;
  // next-intl forwards these request headers to the page. Only the URL, method and headers are carried
  // over: the body stays with the original request.
  const response = login
    ? NextResponse.redirect(login)
    : intlProxy(new NextRequest(request.url, { headers, method: request.method }));

  for (const { name, value, options } of session.cookies) response.cookies.set(name, value, options);
  for (const [name, value] of Object.entries(session.headers)) response.headers.set(name, value);
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
