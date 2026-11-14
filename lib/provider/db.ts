import 'server-only';

import { z } from 'zod';

import { createSupabaseServer } from '@/lib/db/server';

/**
 * The position 02 database functions, as the signed in caller (spec 0006). Each throws the PostgREST
 * error as it came, so the action can map the function's stable code (`lib/provider/codes.ts`).
 */

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

export async function saveProfileInDb(input: {
  entityType: string;
  legalName: string | null;
  taxNumber: string | null;
  bio: string;
  years: number;
  languages: string[];
}): Promise<{ backToReview: boolean }> {
  const data = await call('save_provider_profile', {
    p_entity_type: input.entityType,
    p_legal_name: input.legalName,
    p_tax_number: input.taxNumber,
    p_bio: input.bio,
    p_years: input.years,
    p_languages: input.languages,
  });
  return z.object({ backToReview: z.boolean() }).parse(data);
}

export async function acceptDocsConsentInDb(locale: string): Promise<void> {
  await call('accept_provider_docs_consent', { p_locale: locale });
}

const Registered = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  object_id: z.string(),
  previous_path: z.string().nullable(),
  sweep: z.array(z.string()),
  backToReview: z.boolean(),
  created: z.boolean(),
});
export type Registered = z.infer<typeof Registered>;

export async function registerDocumentInDb(type: string, path: string): Promise<Registered> {
  return Registered.parse(await call('register_provider_document', { p_type: type, p_path: path }));
}

const Submitted = z.object({
  status: z.string(),
  missing: z.array(z.string()),
  rejected: z.array(z.string()),
  objectsMissing: z.array(z.string()),
});
export type Submitted = z.infer<typeof Submitted>;

export async function submitFileInDb(): Promise<Submitted> {
  return Submitted.parse(await call('submit_provider_file', {}));
}

export async function reviewDocumentsInDb(input: {
  providerId: string;
  ids: string[];
  objectIds: string[];
  verdict: string;
  code: string | null;
  note: string | null;
  validUntil: string | null;
}): Promise<void> {
  await call('review_provider_documents', {
    p_provider_id: input.providerId,
    p_ids: input.ids,
    p_object_ids: input.objectIds,
    p_verdict: input.verdict,
    p_code: input.code,
    p_note: input.note,
    p_valid_until: input.validUntil,
  });
}

const StatusResult = z.object({ status: z.string() });
/** `replayed`: the file was already decided, by a second click or a second admin. */
const DecideResult = z.object({ status: z.string(), replayed: z.boolean() });

export async function decideProviderInDb(input: {
  providerId: string;
  decision: string;
  seenUpdatedAt: string;
  code: string | null;
  note: string | null;
}): Promise<{ status: string; replayed: boolean }> {
  return DecideResult.parse(
    await call('decide_provider', {
      p_provider_id: input.providerId,
      p_decision: input.decision,
      p_seen_updated_at: input.seenUpdatedAt,
      p_code: input.code,
      p_note: input.note,
    }),
  );
}

export async function suspendProviderInDb(providerId: string, reason: string): Promise<{ status: string }> {
  return StatusResult.parse(await call('suspend_provider', { p_provider_id: providerId, p_reason: reason }));
}

export async function reinstateProviderInDb(providerId: string): Promise<{ status: string }> {
  return StatusResult.parse(await call('reinstate_provider', { p_provider_id: providerId }));
}

const Viewed = z.object({
  bucket: z.enum(['provider-documents', 'provider-photos']),
  path: z.string(),
  mime_type: z.string(),
});

export async function logDocumentViewInDb(
  documentId: string,
  objectId: string,
): Promise<z.infer<typeof Viewed>> {
  return Viewed.parse(await call('log_document_view', { p_document_id: documentId, p_object_id: objectId }));
}
