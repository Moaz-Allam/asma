import 'server-only';

import { z } from 'zod';

import { createSupabaseServer } from '@/lib/db/server';
import { LocaleSchema } from '@/lib/validation';

/**
 * The signed in user's own profile. RLS keeps every read and write to the caller's row, and the column
 * grants keep `role`, `region` and `phone` out of reach (spec 0005 AC-9, AC-14).
 */

export const FullNameSchema = z.string().trim().min(2).max(100);

const ProfileSchema = z.object({
  full_name: z.string(),
  phone: z.string(),
  locale: LocaleSchema,
});

export type Profile = { fullName: string; phone: string; locale: z.infer<typeof LocaleSchema> };

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, phone, locale')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = ProfileSchema.parse(data);
  return { fullName: row.full_name, phone: row.phone, locale: row.locale };
}

export async function updateProfile(
  userId: string,
  changes: { full_name?: string; locale?: Profile['locale'] },
): Promise<void> {
  const supabase = await createSupabaseServer();
  const { error } = await supabase.from('profiles').update(changes).eq('id', userId);
  if (error) throw error;
}

/** The role and region the database settled on. Throws its stable code as the message. */
export async function completeOnboardingInDb(input: {
  role: string;
  fullName: string;
  locale: string;
  accepted: boolean;
}): Promise<{ role: string }> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc('complete_onboarding', {
    p_role: input.role,
    p_full_name: input.fullName,
    p_locale: input.locale,
    p_accept_terms: input.accepted,
  });
  if (error) throw error;
  return z.object({ role: z.string() }).parse(data);
}
