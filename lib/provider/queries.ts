import 'server-only';

import { cache } from 'react';
import { z } from 'zod';

import { createSupabaseServer } from '@/lib/db/server';
import { DOCUMENT_TYPES, isDocumentType, type DocumentType } from '@/lib/storage/buckets';

import {
  ENTITY_TYPES,
  isStanding,
  PROVIDER_LANGUAGES,
  PROVIDER_STATUSES,
  REJECTION_CODES,
  REVIEW_REASONS,
  type Standing,
} from './options';

/**
 * Server reads of position 02 (spec 0006), through the caller's RLS: a provider reads only their own
 * rows, an admin all, a customer none. Never the service role.
 */

const DocumentRow = z.object({
  id: z.string(),
  type: z.enum(DOCUMENT_TYPES),
  object_id: z.string(),
  storage_path: z.string(),
  mime_type: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  rejection_code: z.enum(REJECTION_CODES).nullable(),
  rejection_note: z.string().nullable(),
  valid_until: z.string().nullable(),
  uploaded_at: z.string(),
});

export type ProviderDocument = {
  id: string;
  type: DocumentType;
  objectId: string;
  path: string;
  mimeType: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionCode: z.infer<typeof DocumentRow>['rejection_code'];
  rejectionNote: string | null;
  validUntil: string | null;
  uploadedAt: string;
};

function toDocument(row: z.infer<typeof DocumentRow>): ProviderDocument {
  return {
    id: row.id,
    type: row.type,
    objectId: row.object_id,
    path: row.storage_path,
    mimeType: row.mime_type,
    status: row.status,
    rejectionCode: row.rejection_code,
    rejectionNote: row.rejection_note,
    validUntil: row.valid_until,
    uploadedAt: row.uploaded_at,
  };
}

const ProviderRow = z.object({
  id: z.string(),
  region: z.enum(['TR', 'KSA']),
  status: z.enum(PROVIDER_STATUSES),
  entity_type: z.enum(ENTITY_TYPES).nullable(),
  legal_name: z.string().nullable(),
  tax_number: z.string().nullable(),
  review_reason: z.enum(REVIEW_REASONS).nullable(),
  rejection_code: z.enum(REJECTION_CODES).nullable(),
  rejection_note: z.string().nullable(),
  suspension_reason: z.string().nullable(),
  submitted_at: z.string().nullable(),
  decided_at: z.string().nullable(),
  approved_at: z.string().nullable(),
  approved_name: z.string().nullable(),
  updated_at: z.string(),
});

const PROVIDER_COLUMNS =
  'id, region, status, entity_type, legal_name, tax_number, review_reason, rejection_code, rejection_note, ' +
  'suspension_reason, submitted_at, decided_at, approved_at, approved_name, updated_at';

const ProfileRow = z.object({
  bio: z.string(),
  years_experience: z.number().int(),
  languages: z.array(z.enum(PROVIDER_LANGUAGES)),
});

export type ProviderProfile = {
  bio: string;
  years: number;
  languages: (typeof PROVIDER_LANGUAGES)[number][];
};

export type ProviderFile = {
  id: string;
  region: 'TR' | 'KSA';
  status: (typeof PROVIDER_STATUSES)[number];
  entityType: (typeof ENTITY_TYPES)[number] | null;
  legalName: string | null;
  taxNumber: string | null;
  reviewReason: z.infer<typeof ProviderRow>['review_reason'];
  rejectionCode: z.infer<typeof ProviderRow>['rejection_code'];
  rejectionNote: string | null;
  suspensionReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  approvedAt: string | null;
  approvedName: string | null;
  updatedAt: string;
  profile: ProviderProfile | null;
  documents: Partial<Record<DocumentType, ProviderDocument>>;
  requiredTypes: DocumentType[];
};

function toFile(
  row: z.infer<typeof ProviderRow>,
  profile: z.infer<typeof ProfileRow> | null,
  documents: z.infer<typeof DocumentRow>[],
  requiredTypes: DocumentType[],
): ProviderFile {
  return {
    id: row.id,
    region: row.region,
    status: row.status,
    entityType: row.entity_type,
    legalName: row.legal_name,
    taxNumber: row.tax_number,
    reviewReason: row.review_reason,
    rejectionCode: row.rejection_code,
    rejectionNote: row.rejection_note,
    suspensionReason: row.suspension_reason,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    approvedAt: row.approved_at,
    approvedName: row.approved_name,
    updatedAt: row.updated_at,
    profile: profile
      ? { bio: profile.bio, years: profile.years_experience, languages: profile.languages }
      : null,
    documents: Object.fromEntries(documents.map((d) => [d.type, toDocument(d)])),
    requiredTypes,
  };
}

/**
 * `provider_standing()` for one provider: null when the caller cannot read the row (never `draft`).
 * Cached per request, so the provider layout and its page ask the database once.
 */
export const getStanding = cache(async (providerId: string): Promise<Standing | null> => {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc('provider_standing', { p_provider_id: providerId });
  if (error) throw error;
  return isStanding(data) ? data : null;
});

async function requiredTypes(region: string): Promise<DocumentType[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc('provider_required_types', { p_region: region });
  if (error) throw error;
  return z.array(z.string()).parse(data).filter(isDocumentType);
}

/** A provider's whole file, as RLS lets the caller read it, or null. */
export async function getProviderFile(providerId: string): Promise<ProviderFile | null> {
  const supabase = await createSupabaseServer();
  const [provider, profile, documents] = await Promise.all([
    supabase.from('providers').select(PROVIDER_COLUMNS).eq('id', providerId).maybeSingle(),
    supabase
      .from('provider_profiles')
      .select('bio, years_experience, languages')
      .eq('provider_id', providerId)
      .maybeSingle(),
    supabase
      .from('provider_documents')
      .select(
        'id, type, object_id, storage_path, mime_type, status, rejection_code, rejection_note, valid_until, uploaded_at',
      )
      .eq('provider_id', providerId),
  ]);
  if (provider.error) throw provider.error;
  if (profile.error) throw profile.error;
  if (documents.error) throw documents.error;
  if (!provider.data) return null;
  const row = ProviderRow.parse(provider.data);
  return toFile(
    row,
    profile.data ? ProfileRow.parse(profile.data) : null,
    z.array(DocumentRow).parse(documents.data ?? []),
    await requiredTypes(row.region),
  );
}

/** Whether the caller accepted the current documents consent of their region (AC-6). */
export async function hasDocsConsent(userId: string, region: string): Promise<boolean> {
  const supabase = await createSupabaseServer();
  const { data: setting, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('region', region)
    .eq('key', 'provider_docs_consent_version')
    .maybeSingle();
  if (error) throw error;
  const version = typeof setting?.value === 'string' ? setting.value : null;
  if (version === null) return false;
  const { count, error: readError } = await supabase
    .from('terms_acceptances')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('terms_version', version);
  if (readError) throw readError;
  return (count ?? 0) > 0;
}

/** The status of a provider's own row, for the account page's warning before a rename (AC-12). */
export async function getOwnStatus(userId: string): Promise<(typeof PROVIDER_STATUSES)[number] | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from('providers').select('status').eq('id', userId).maybeSingle();
  if (error) throw error;
  const parsed = z.object({ status: z.enum(PROVIDER_STATUSES) }).safeParse(data);
  return parsed.success ? parsed.data.status : null;
}
