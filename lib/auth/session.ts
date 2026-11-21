import 'server-only';

import { getLocale } from 'next-intl/server';
import { cache } from 'react';

import { createSupabaseServer } from '@/lib/db/server';
import { redirect } from '@/lib/i18n/navigation';
import { isRegion, type Region } from '@/lib/region';

import { homeFor, isRole, type Role } from './roles';

/**
 * Who is asking (spec 0005 AC-12). The user is verified with the Auth server through `getUser()`,
 * never `getSession()`, which only reads the cookie (lint enforced). The role comes from `app_metadata`,
 * which only the database writes, so a user cannot set it.
 *
 * `proxy.ts` is UX. These are the checks that hold: every page calls `guardPage` itself, because
 * layouts do not run again on client navigation, and every Server Action goes through `guardedAction`.
 */

export type SessionUser = {
  id: string;
  role: Role | null;
  region: Region | null;
  /** Spec 0012 AC-4: written only by `password_guard`; fresh from `getUser`, never read from the JWT. */
  hasPassword: boolean;
  /** Spec 0012 AC-7: when the password last changed, an ISO time, or null. */
  passwordChangedAt: string | null;
};
export type RoleUser = SessionUser & { role: Role };

/** A refusal in a Server Action. `guardedAction` turns it into `{ success: false, error: code }`. */
export class AuthRefusal extends Error {
  constructor(readonly code: 'unauthorized' | 'forbidden') {
    super(code);
    this.name = 'AuthRefusal';
  }
}

async function readUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { role, region, has_password: hasPassword, password_changed_at: changedAt } = data.user.app_metadata;
  return {
    id: data.user.id,
    role: isRole(role) ? role : null,
    region: isRegion(region) ? region : null,
    hasPassword: hasPassword === true,
    passwordChangedAt: typeof changedAt === 'string' ? changedAt : null,
  };
}

/** The signed in user, or null. A render reuses one check; use `requireUser` in an action. */
export const getSessionUser = cache(readUser);

/** A signed in user, role or not. Asks the Auth server every time: an action never reuses a check. */
export async function requireUser(): Promise<SessionUser> {
  const user = await readUser();
  if (!user) throw new AuthRefusal('unauthorized');
  return user;
}

/** A user holding one of `roles`, or any role when none is named. */
export async function requireRole(...roles: Role[]): Promise<RoleUser> {
  const user = await requireUser();
  const { role } = user;
  if (role === null || (roles.length > 0 && !roles.includes(role))) throw new AuthRefusal('forbidden');
  return { ...user, role };
}

/** The guard at the top of every private page. Redirects, so it returns only for the right user. */
export async function guardPage(allowed: readonly Role[] | 'any'): Promise<RoleUser> {
  const locale = await getLocale();
  const user = await getSessionUser();
  if (!user) return redirect({ href: '/login', locale });
  const { role } = user;
  if (role === null) return redirect({ href: '/onboarding', locale });
  if (allowed !== 'any' && !allowed.includes(role)) return redirect({ href: homeFor(role), locale });
  return { ...user, role };
}

/** Ends this device's session only. The library's default ends every device. */
export async function signOutHere(): Promise<void> {
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

/** A new token, so RLS sees what the database just wrote into `app_metadata`. */
export async function refreshToken(): Promise<void> {
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.refreshSession();
  if (error) throw error;
}
