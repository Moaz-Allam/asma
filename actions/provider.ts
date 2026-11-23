'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';

import { ProviderAddressInput } from '@/lib/address/parts';
import { fail, guardedAction } from '@/lib/auth/action';
import { log } from '@/lib/observability/log';
import { databaseCode, PROVIDER_DB_CODES } from '@/lib/provider/codes';
import {
  acceptDocsConsentInDb,
  registerDocumentInDb,
  saveAddressInDb,
  saveProfileInDb,
  submitFileInDb,
} from '@/lib/provider/db';
import { ProviderProfileSchema, RegisterDocumentSchema } from '@/lib/provider/schemas';
import { bucketFor } from '@/lib/storage/buckets';
import { removeOld } from '@/lib/storage/server';

/**
 * The provider's writes in position 02 (spec 0006). Each calls one database function, which holds every
 * rule, so a direct API call meets the same refusals. A stable code from the function is mapped and
 * reaches no Sentry report. Every action that can change the standing revalidates the layout, which
 * reads it once per request (AC-10).
 */

async function mapped<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    const code = databaseCode(error, PROVIDER_DB_CODES);
    if (code) return fail(code);
    throw error;
  }
}

/** Step 1 (AC-2, AC-3, AC-12). Answers whether the save sent an approved file back to review. */
export const saveProviderProfile = guardedAction(
  { name: 'saveProviderProfile', access: ['provider'], schema: ProviderProfileSchema },
  async (input) =>
    mapped(async () => {
      const result = await saveProfileInDb({
        ...input,
        legalName: input.entityType === 'company' ? input.legalName : null,
        taxNumber: input.entityType === 'company' ? input.taxNumber : null,
      });
      revalidatePath('/', 'layout');
      return result;
    }),
);

/** Spec 0011-20b AC-5: the provider's own address (any standing). The parts and the pin only; Postgres checks them. */
export const saveProviderAddress = guardedAction(
  { name: 'saveProviderAddress', access: ['provider'], schema: ProviderAddressInput },
  async (input) =>
    mapped(async () => {
      await saveAddressInDb(input);
      revalidatePath('/', 'layout');
      return { saved: true };
    }),
);

/** The documents consent (AC-6), with the page's locale and the database's time. */
export const acceptDocsConsent = guardedAction(
  { name: 'acceptDocsConsent', access: ['provider'], schema: z.undefined() },
  async () =>
    mapped(async () => {
      await acceptDocsConsentInDb(await getLocale());
      revalidatePath('/', 'layout');
      return { done: true };
    }),
);

/**
 * Registers an object the browser just uploaded (AC-7, AC-8). After the row commits, the old file and any
 * older orphan of that type go at once. If a delete fails the row is still right, an event is logged,
 * and the next upload of that type tries again, because the function lists the orphans each time.
 */
export const registerDocument = guardedAction(
  { name: 'registerDocument', access: ['provider'], schema: RegisterDocumentSchema },
  async ({ type, path }, user) =>
    mapped(async () => {
      const row = await registerDocumentInDb(type, path);
      const stale = [...(row.previous_path ? [row.previous_path] : []), ...row.sweep];
      if (stale.length > 0) {
        const { failed } = await removeOld(bucketFor(type), stale);
        if (failed.length > 0)
          log.warn('document_sweep_failed', { user_id: user.id, region: user.region ?? undefined });
      }
      revalidatePath('/', 'layout');
      return { id: row.id, status: row.status, backToReview: row.backToReview };
    }),
);

export type SubmitOutcome =
  | { status: 'pending' | 'approved'; incomplete: null }
  | { status: string; incomplete: { code: 'file_incomplete' | 'file_missing'; types: string[] } };

/**
 * Send for review (AC-9). When anything is missing nothing is written, and the outcome names the types,
 * so the cards can say which.
 */
export const submitProviderFile = guardedAction(
  { name: 'submitProviderFile', access: ['provider'], schema: z.undefined() },
  async (): Promise<SubmitOutcome | ReturnType<typeof fail>> =>
    mapped(async (): Promise<SubmitOutcome> => {
      const result = await submitFileInDb();
      revalidatePath('/', 'layout');
      // A lost object leads the message, but every card that needs work is named, not only that one.
      if (result.objectsMissing.length > 0) {
        return {
          status: result.status,
          incomplete: {
            code: 'file_missing',
            types: [...result.objectsMissing, ...result.missing, ...result.rejected],
          },
        };
      }
      if (result.missing.length > 0 || result.rejected.length > 0) {
        return {
          status: result.status,
          incomplete: { code: 'file_incomplete', types: [...result.missing, ...result.rejected] },
        };
      }
      return { status: result.status === 'approved' ? 'approved' : 'pending', incomplete: null };
    }),
);
