'use client';

import { createBrowserClient } from '@supabase/ssr';

import { authCookieOptions } from './cookies';

/**
 * Browser Supabase client. Client Components only.
 *
 * Carries the ANON key and the user's session JWT. architecture.md §2: the
 * browser is hostile — this key ships to everyone, so RLS is what protects the
 * data, not this file.
 *
 * ⛔ Never use in a server context. ⛔ Never reach for service_role here.
 */

// code-standards.md §1 — no non-null assertion on a value crossing a boundary.
// `process.env` in the browser is exactly that: Next inlines these at build time,
// and a missing one yields `undefined`, which would construct a broken client and
// fail later with an opaque network error instead of here with a clear one.
//
// No Zod in the browser: on load it probes with `Function("")`, which the nonce CSP refuses, so every
// page would report a violation (spec 0005 AC-23). A plain check says the same thing here.
export function createSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !URL.canParse(url) || !anonKey) {
    throw new Error(
      'Supabase browser client is misconfigured: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set at build time. See .env.example.',
    );
  }

  return createBrowserClient(url, anonKey, { cookieOptions: authCookieOptions() });
}
