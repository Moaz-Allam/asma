import createIntlProxy from 'next-intl/middleware';

import { routing } from '@/lib/i18n/routing';

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
 * Today it does one job: negotiate the locale and redirect accordingly.
 * Feature 02 adds an unauthenticated-user redirect here for UX — and the real
 * check in the actions themselves.
 */
export const proxy = createIntlProxy(routing);

export const config = {
  // Everything except Next internals, the API surface, and static files.
  // `api` is deliberately excluded: machine endpoints are not localized.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
