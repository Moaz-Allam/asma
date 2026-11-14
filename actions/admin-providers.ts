'use server';

import { revalidatePath } from 'next/cache';

import { fail, guardedAction } from '@/lib/auth/action';
import { log } from '@/lib/observability/log';
import { ADMIN_DB_CODES, databaseCode } from '@/lib/provider/codes';
import {
  decideProviderInDb,
  logDocumentViewInDb,
  reinstateProviderInDb,
  reviewDocumentsInDb,
  suspendProviderInDb,
} from '@/lib/provider/db';
import {
  DecideProviderSchema,
  ProviderIdSchema,
  ReviewDocumentsSchema,
  ShowDocumentSchema,
  SuspendProviderSchema,
} from '@/lib/provider/schemas';
import { SIGNED_LINK_SECONDS } from '@/lib/storage/buckets';
import { signedLink } from '@/lib/storage/server';

/**
 * Admin's writes in position 02 (spec 0006 AC-16 to AC-19). Each database function checks `is_admin()`
 * itself and locks the provider row, so a second admin or a second click gets the state as it stands.
 */

async function mapped<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    const code = databaseCode(error, ADMIN_DB_CODES);
    if (code) return fail(code);
    throw error;
  }
}

/**
 * Show a document (AC-16). The view row is written first; only then is a 60 second link signed, and
 * Storage itself refuses an admin with no fresh view row. If the audit write fails there is no link.
 * The link goes back to the admin's browser only: never logged, never in a URL of ours.
 */
export const showDocument = guardedAction(
  { name: 'showDocument', access: ['admin'], schema: ShowDocumentSchema },
  async ({ documentId, objectId }, user) => {
    let viewed: Awaited<ReturnType<typeof logDocumentViewInDb>>;
    try {
      viewed = await logDocumentViewInDb(documentId, objectId);
    } catch (error) {
      const code = databaseCode(error, ADMIN_DB_CODES);
      if (code) return fail(code);
      log.error('document_view_audit_failed', { user_id: user.id });
      return fail('action_failed');
    }
    const url = await signedLink(viewed.bucket, viewed.path, SIGNED_LINK_SECONDS);
    if (!url) return fail('file_missing');
    return { url, kind: viewed.mime_type === 'application/pdf' ? ('pdf' as const) : ('image' as const) };
  },
);

/** Match or reject one document, or both ID sides in one click (AC-17). */
export const reviewDocuments = guardedAction(
  { name: 'reviewDocuments', access: ['admin'], schema: ReviewDocumentsSchema },
  async (input) =>
    mapped(async () => {
      await reviewDocumentsInDb(input);
      revalidatePath('/', 'layout');
      return { done: true };
    }),
);

/** Approve or reject the file (AC-18), with the version of the profile the page showed. */
export const decideProvider = guardedAction(
  { name: 'decideProvider', access: ['admin'], schema: DecideProviderSchema },
  async (input) =>
    mapped(async () => {
      const result = await decideProviderInDb(input);
      revalidatePath('/', 'layout');
      return result;
    }),
);

/** Suspend an approved provider with a reason shown to them as written (AC-19). */
export const suspendProvider = guardedAction(
  { name: 'suspendProvider', access: ['admin'], schema: SuspendProviderSchema },
  async ({ providerId, reason }) =>
    mapped(async () => {
      const result = await suspendProviderInDb(providerId, reason);
      revalidatePath('/', 'layout');
      return result;
    }),
);

/** Lift a suspension, back to approved (AC-19). */
export const reinstateProvider = guardedAction(
  { name: 'reinstateProvider', access: ['admin'], schema: ProviderIdSchema },
  async ({ providerId }) =>
    mapped(async () => {
      const result = await reinstateProviderInDb(providerId);
      revalidatePath('/', 'layout');
      return result;
    }),
);
