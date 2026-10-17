'use client';

import { createBrowserClient } from '@supabase/ssr';
import { z } from 'zod';

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
const BrowserEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export function createSupabaseBrowser() {
  const parsed = BrowserEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      'Supabase browser client is misconfigured: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set at build time. See .env.example.',
    );
  }

  return createBrowserClient(parsed.data.NEXT_PUBLIC_SUPABASE_URL, parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
