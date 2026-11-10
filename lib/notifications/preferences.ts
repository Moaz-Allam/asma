import 'server-only';

import { z } from 'zod';

import { createSupabaseServer } from '@/lib/db/server';

import type { Topic } from './topics';

/**
 * A user's own notice switches. No row means on (spec 0005 AC-33). RLS keeps every read and write to the
 * caller's rows, and the database writes the region from their profile.
 */

const RowsSchema = z.array(z.object({ topic: z.string(), email_enabled: z.boolean() }));

/** The topics this user turned off. */
export async function getTurnedOffTopics(userId: string): Promise<string[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('topic, email_enabled')
    .eq('user_id', userId);
  if (error) throw error;
  return RowsSchema.parse(data)
    .filter((row) => !row.email_enabled)
    .map((row) => row.topic);
}

export async function savePreference(userId: string, topic: Topic, enabled: boolean): Promise<void> {
  const supabase = await createSupabaseServer();
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, topic, email_enabled: enabled }, { onConflict: 'user_id,topic' });
  if (error) throw error;
}
