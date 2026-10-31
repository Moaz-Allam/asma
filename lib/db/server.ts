import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getEnv } from '@/lib/env';

import { authCookieOptions } from './cookies';

/**
 * Session-scoped server client. Server Components, Server Actions, Route Handlers.
 *
 * RLS APPLIES. This is the default for anything serving a user request — it is
 * the client that keeps the security model intact.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(getEnv().NEXT_PUBLIC_SUPABASE_URL, getEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
