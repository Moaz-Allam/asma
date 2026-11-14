import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';

import type { Bucket } from './buckets';

/**
 * Server side Storage calls, always as the signed in user, so the Storage policies decide (spec 0006
 * AC-16, AC-22). No service role: an admin's link is signed only with a fresh view row
 * (`admin_may_read`), and a provider deletes only objects no row points to.
 *
 * A signed link works for anyone holding it until it expires, so it is never logged, never put in a URL
 * of ours, and never sent to telemetry (`scrubUrl` cuts any Storage URL after its bucket as well).
 */

/** A signed link, or null when Storage refuses or the object is gone. */
export async function signedLink(bucket: Bucket, path: string, seconds: number): Promise<string | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Deletes objects no row points to any more (AC-8). `remove()` answers with what it really deleted, and
 * a hidden or kept object is simply missing from that list, so the two are compared: `failed` is every
 * path asked for that is still there.
 */
export async function removeOld(bucket: Bucket, paths: readonly string[]): Promise<{ failed: string[] }> {
  const unique = [...new Set(paths)].filter((path) => path.length > 0);
  if (unique.length === 0) return { failed: [] };
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.storage.from(bucket).remove(unique);
    if (error || !data) return { failed: unique };
    const removed = new Set(data.map((object) => object.name));
    return { failed: unique.filter((path) => !removed.has(path)) };
  } catch {
    return { failed: unique };
  }
}
