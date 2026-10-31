import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { getEnv } from '@/lib/env';

/**
 * Stateless anonymous client: the ANON key, no cookies, no session, nothing persisted.
 *
 * For machine endpoints that serve no user, such as GET /api/health calling health_ping() (spec 0004
 * AC-10). RLS applies with the `anon` role, which reads no table and may call only the functions
 * granted to it on purpose (supabase/tests/02_function_grants.test.sql).
 */
export function createAnonClient() {
  return createClient(getEnv().NEXT_PUBLIC_SUPABASE_URL, getEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
