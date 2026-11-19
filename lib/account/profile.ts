import 'server-only';

import { z } from 'zod';

import { createSupabaseServer } from '@/lib/db/server';
import { log } from '@/lib/observability/log';
import { LocaleSchema } from '@/lib/validation';

/**
 * The signed in user's own profile. RLS keeps every read and write to the caller's row, and the column
 * grants keep `role`, `region` and `phone` out of reach (spec 0005 AC-9, AC-14).
 */

export const FullNameSchema = z.string().trim().min(2).max(100);

/**
 * The contact email, or null. Lowercased with plain `toLowerCase`, never a Turkish locale (rule 10): an
 * identifier that folded to a dotless ı would never match again. An empty field removes the address.
 */
export const ContactEmailSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.union([z.literal('').transform(() => null), z.null(), z.email().max(254)]),
);

const ProfileSchema = z.object({
  full_name: z.string(),
  phone: z.string(),
  locale: LocaleSchema,
  email: z.string().nullable(),
  email_confirmed_at: z.string().nullable(),
});

export type Profile = {
  fullName: string;
  phone: string;
  locale: z.infer<typeof LocaleSchema>;
  email: string | null;
  emailConfirmed: boolean;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, phone, locale, email, email_confirmed_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = ProfileSchema.parse(data);
  return {
    fullName: row.full_name,
    phone: row.phone,
    locale: row.locale,
    email: row.email,
    emailConfirmed: row.email_confirmed_at !== null,
  };
}

export async function updateProfile(
  userId: string,
  changes: { full_name?: string; locale?: Profile['locale']; email?: string | null },
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

/**
 * Spec 0011-13 AC-4, AC-7, R-10: whether the caller's address is confirmed, and the two mail switches of their
 * region (`platform_settings`, readable by every signed in user). The banner and "Send link again" show only while
 * mail is on; the provider's prompt only while the apply gate is. Read with the caller's own client.
 */
export type EmailStanding = {
  hasEmail: boolean;
  confirmed: boolean;
  emailsEnabled: boolean;
  applyNeedsEmail: boolean;
};

const StandingSchema = z.object({
  region: z.string(),
  email: z.string().nullable(),
  email_confirmed_at: z.string().nullable(),
});

export async function getEmailStanding(userId: string): Promise<EmailStanding> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from('profiles')
    .select('region, email, email_confirmed_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { hasEmail: false, confirmed: false, emailsEnabled: false, applyNeedsEmail: false };
  const row = StandingSchema.parse(data);
  const { data: settings, error: settingsError } = await supabase
    .from('platform_settings')
    .select('key, value')
    .eq('region', row.region)
    .in('key', ['emails_enabled', 'apply_needs_email']);
  if (settingsError) throw settingsError;
  // Fails closed, as the database's readers do: a missing or non boolean row is off.
  const on = (key: string) => (settings ?? []).some((s) => s.key === key && s.value === true);
  return {
    hasEmail: row.email !== null,
    confirmed: row.email !== null && row.email_confirmed_at !== null,
    emailsEnabled: on('emails_enabled'),
    applyNeedsEmail: on('apply_needs_email'),
  };
}

/** AC-7: a new link for the caller's address. Throws the database's stable code as the message. */
export async function requestEmailConfirmationInDb(): Promise<void> {
  const supabase = await createSupabaseServer();
  const { error } = await supabase.rpc('request_email_confirmation');
  if (error) throw error;
}

/** AC-7: confirms the caller's address with the link's token. Throws the database's stable code as the message. */
export async function confirmEmailInDb(token: string): Promise<void> {
  const supabase = await createSupabaseServer();
  const { error } = await supabase.rpc('confirm_email', { p_token: token });
  if (error) throw error;
}

/** R-9: 32 random bytes in base64url. Anything else is refused before the database is asked. */
export const ConfirmTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * Spec 0011-13 AC-4: whether to nudge the caller to add and confirm an address. A customer while mail is on in
 * their region; a provider while the apply gate is on. Never a block: a failed read shows no nudge.
 */
export async function needsEmailNudge(userId: string, kind: 'customer' | 'provider'): Promise<boolean> {
  try {
    const standing = await getEmailStanding(userId);
    if (standing.confirmed) return false;
    return kind === 'customer' ? standing.emailsEnabled : standing.applyNeedsEmail;
  } catch {
    log.warn('email_standing_failed', { user_id: userId });
    return false;
  }
}
