'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';

import {
  ConfirmTokenSchema,
  ContactEmailSchema,
  FullNameSchema,
  confirmEmailInDb,
  requestEmailConfirmationInDb,
  updateProfile,
} from '@/lib/account/profile';
import { fail, guardedAction } from '@/lib/auth/action';
import { databaseCode } from '@/lib/provider/codes';
import { getOwnStatus } from '@/lib/provider/queries';
import { signOutHere } from '@/lib/auth/session';
import { savePreference } from '@/lib/notifications/preferences';
import { TOPICS } from '@/lib/notifications/topics';
import { LocaleSchema } from '@/lib/validation';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/i18n/routing';

/** Ends this device's session only (spec 0005 AC-19). The client then leaves with a full page load. */
export const signOut = guardedAction(
  { name: 'signOut', access: 'signed_in', schema: z.undefined() },
  async () => {
    await signOutHere();
    return { done: true };
  },
);

/**
 * The name (spec 0005). For an approved provider a real change returns the file to review in the same
 * database transaction (spec 0006 AC-12, the `provider_name_changed` trigger); `backToReview` says so,
 * read from the database after the save (approved before, pending after), never guessed from the form.
 * A suspended provider cannot rename: the trigger refuses with `provider_suspended`, mapped here, so it
 * reaches no Sentry report.
 */
export const updateAccount = guardedAction(
  { name: 'updateAccount', access: 'any_role', schema: z.object({ fullName: FullNameSchema }) },
  async ({ fullName }, user) => {
    const before = user.role === 'provider' ? await getOwnStatus(user.id) : null;
    try {
      await updateProfile(user.id, { full_name: fullName });
    } catch (error) {
      const code = databaseCode(error, ['provider_suspended']);
      if (code) return fail(code);
      throw error;
    }
    const after = before === 'approved' ? await getOwnStatus(user.id) : before;
    revalidatePath('/', 'layout');
    return { done: true, backToReview: before === 'approved' && after === 'pending' };
  },
);

/** Contact only, never a way in. Nothing is sent to it until position 13 confirms it (AC-32). */
export const updateEmail = guardedAction(
  { name: 'updateEmail', access: 'any_role', schema: z.object({ email: ContactEmailSchema }) },
  async ({ email }, user) => {
    await updateProfile(user.id, { email });
    return { done: true };
  },
);

/** Only topics that can be turned off exist here: money and deadline notices are always on (AC-33). */
export const setNotificationPreference = guardedAction(
  {
    name: 'setNotificationPreference',
    access: 'any_role',
    schema: z.object({ topic: z.enum(TOPICS), enabled: z.boolean() }),
  },
  async ({ topic, enabled }, user) => {
    await savePreference(user.id, topic, enabled);
    return { done: true };
  },
);

/** The language wins over the cookie from here on: `/continue` follows it after each sign in (AC-10). */
export const updateLocale = guardedAction(
  { name: 'updateLocale', access: 'any_role', schema: z.object({ locale: LocaleSchema }) },
  async ({ locale }, user) => {
    await updateProfile(user.id, { locale });
    (await cookies()).set(LOCALE_COOKIE, locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: LOCALE_COOKIE_MAX_AGE,
    });
    return { done: true };
  },
);

/** Spec 0011-13 AC-7: "Send link again". The database refuses each case by its code. */
const REQUEST_LINK_CODES = ['no_email', 'already_confirmed', 'emails_off', 'rate_limited'] as const;

export const requestEmailConfirmation = guardedAction(
  { name: 'requestEmailConfirmation', access: 'any_role', schema: z.undefined() },
  async () => {
    try {
      await requestEmailConfirmationInDb();
    } catch (error) {
      const code = databaseCode(error, REQUEST_LINK_CODES);
      if (code) return fail(code);
      throw error;
    }
    return { done: true };
  },
);

/**
 * Spec 0011-13 AC-7: the confirm page's one button, a POST, so a mail scanner that opens the link confirms
 * nothing. Only the signed in owner of the link confirms it; every other case is one of three codes.
 */
const CONFIRM_CODES = ['invalid_link', 'link_expired', 'link_used'] as const;

export const confirmEmail = guardedAction(
  { name: 'confirmEmail', access: 'any_role', schema: z.object({ token: z.string().max(100) }) },
  async ({ token }) => {
    const parsed = ConfirmTokenSchema.safeParse(token);
    if (!parsed.success) return fail('invalid_link');
    try {
      await confirmEmailInDb(parsed.data);
    } catch (error) {
      const code = databaseCode(error, CONFIRM_CODES);
      if (code) return fail(code);
      throw error;
    }
    revalidatePath('/', 'layout');
    return { done: true };
  },
);
