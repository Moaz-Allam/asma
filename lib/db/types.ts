import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Any of our Supabase clients, for code outside lib/db that receives one rather than creating it
 * (spec 0004: `isEnabled(flag, region, db)`). Its RLS decides what the caller may read: a signed in
 * session, the admin client of a job, or the anonymous client.
 */
export type Db = SupabaseClient;
