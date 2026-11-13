'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ContactEmailSchema, FullNameSchema, updateProfile } from '@/lib/account/profile';
import { guardedAction } from '@/lib/auth/action';
import { signOutHere } from '@/lib/auth/session';
import { savePreference } from '@/lib/notifications/preferences';
import { TOPICS } from '@/lib/notifications/topics';
import { LocaleSchema } from '@/lib/validation';

/** Ends this device's session only (spec 0005 AC-19). The client then leaves with a full page load. */
export const signOut = guardedAction(
  { name: 'signOut', access: 'signed_in', schema: z.undefined() },
  async () => {
    await signOutHere();
    return { done: true };
  },
);

export const updateAccount = guardedAction(
  { name: 'updateAccount', access: 'any_role', schema: z.object({ fullName: FullNameSchema }) },
  async ({ fullName }, user) => {
    await updateProfile(user.id, { full_name: fullName });
    revalidatePath('/', 'layout');
    return { done: true };
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
    return { done: true };
  },
);
