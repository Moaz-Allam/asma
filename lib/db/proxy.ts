import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

import { getEnv } from '@/lib/env';

import { authCookieOptions } from './cookies';

/**
 * The session refresh in `proxy.ts` (spec 0005 AC-11), the one place outside lib/auth that touches
 * `supabase.auth` (AC-25). `proxy.ts` is a routing and UX layer: the answer here decides a redirect,
 * never access. Identity for anything that matters comes from `getUser()` in lib/auth/session.ts.
 *
 * `getClaims()` refreshes an expired session and verifies the token: locally with asymmetric keys, or
 * through the Auth server with the local stack's symmetric key.
 */

export type ProxySession = {
  /** `unknown`: Auth could not answer, so the page guard decides. Never a reason to redirect. */
  state: 'signed_in' | 'signed_out' | 'unknown';
  /** Refreshed cookies for the final response, with the options Auth gave them. */
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>;
  /** Cache headers Auth asks for when it sets a cookie. */
  headers: Record<string, string>;
};

// `sb-<ref>-auth-token`, or `.0`, `.1` when a long session is split across cookies.
const AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

function isOutage(error: { status?: number } | null): boolean {
  if (!error) return false;
  return isAuthRetryableFetchError(error) || error.status === undefined || error.status >= 500;
}

/**
 * Reads and refreshes the session. Refreshed cookies are also written onto `request`, so the render that
 * follows sees them. A visitor with no Auth cookie costs no Auth call. Never throws.
 */
export async function refreshSession(request: NextRequest): Promise<ProxySession> {
  const session: ProxySession = { state: 'signed_out', cookies: [], headers: {} };
  if (!request.cookies.getAll().some((cookie) => AUTH_COOKIE.test(cookie.name))) return session;

  try {
    const env = getEnv();
    const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          session.cookies.push(...list.map(({ name, value, options }) => ({ name, value, options })));
          session.headers = headers;
          for (const { name, value } of list) {
            if (value) request.cookies.set(name, value);
            else request.cookies.delete(name);
          }
        },
      },
    });
    const { data, error } = await supabase.auth.getClaims();
    session.state = data ? 'signed_in' : isOutage(error) ? 'unknown' : 'signed_out';
  } catch {
    session.state = 'unknown';
  }
  return session;
}
