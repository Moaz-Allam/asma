'use server';

import { getLocale } from 'next-intl/server';
import { z } from 'zod';

import { fail, guardedAction } from '@/lib/auth/action';
import { firstStopFor, isRole } from '@/lib/auth/roles';
import { refreshToken } from '@/lib/auth/session';
import { completeOnboardingInDb, FullNameSchema } from '@/lib/account/profile';

const OnboardingSchema = z.object({
  // The chosen role is still validated: admin is never offered, and the database refuses it too.
  role: z.enum(['customer', 'provider']),
  fullName: FullNameSchema,
  accepted: z.literal(true),
});

/** The stable codes `complete_onboarding` raises that a person can act on. */
const DB_FAILURES = new Set(['validation_failed', 'phone_not_eligible', 'phone_taken']);

function databaseCode(error: unknown): string | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && DB_FAILURES.has(message) ? message : null;
}

/**
 * Role, name and the agreement, once (spec 0005 AC-7, AC-8). Everything else comes from the verified
 * `auth.users` row inside the database. A retry returns the same destination. The session is refreshed
 * afterwards, so the token carries the role and RLS sees it.
 */
export const completeOnboarding = guardedAction(
  { name: 'completeOnboarding', access: 'signed_in', schema: OnboardingSchema },
  async (input) => {
    try {
      const { role } = await completeOnboardingInDb({ ...input, locale: await getLocale() });
      await refreshToken();
      if (!isRole(role)) return fail('action_failed');
      return { destination: firstStopFor(role) };
    } catch (error) {
      const code = databaseCode(error);
      if (code) return fail(code);
      throw error;
    }
  },
);
