import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { getEnv } from '@/lib/env';

/**
 * service_role client. ⚠️ BYPASSES RLS ENTIRELY.
 *
 * Permitted callers: PSP webhooks, scheduled jobs, and the outbox relay.
 *
 * ⛔ NEVER to serve a normal user request. architecture.md §16: if you reach for
 *    this inside a Server Action, stop — you are about to bypass the entire
 *    security model, and RLS will not save you because it is not consulted.
 *    Use createSupabaseServer() instead so policies apply.
 */
export function createSupabaseAdmin() {
  return createClient(getEnv().NEXT_PUBLIC_SUPABASE_URL, getEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
