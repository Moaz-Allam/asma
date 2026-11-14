import type { DocumentType } from '@/lib/storage/buckets';

/**
 * Provider onboarding lists and limits (spec 0006). The database holds the same lists in its checks;
 * tests/provider-options.test.ts proves they agree with the migration. No Zod and no `server-only`:
 * forms read the limits for their plain checks (D106), and the action and the database decide.
 */

/** Turkish, Arabic, English (owner, 2026-11-01). Equal to `provider_profiles_languages_valid`. */
export const PROVIDER_LANGUAGES = ['tr', 'ar', 'en'] as const;
export type ProviderLanguage = (typeof PROVIDER_LANGUAGES)[number];

export const ENTITY_TYPES = ['individual', 'company'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PROVIDER_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'suspended'] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** What `provider_standing()` returns: the status, or document_expired for an approved provider. */
export const STANDINGS = [...PROVIDER_STATUSES, 'document_expired'] as const;
export type Standing = (typeof STANDINGS)[number];

export function isStanding(value: unknown): value is Standing {
  return typeof value === 'string' && (STANDINGS as readonly string[]).includes(value);
}

export const REVIEW_REASONS = [
  'first_submission',
  'resubmitted',
  'document_replaced',
  'name_changed',
  'company_changed',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REJECTION_CODES = [
  'document_unclear',
  'selfie_mismatch',
  'criminal_record_invalid',
  'document_expired',
  'name_mismatch',
  'photo_not_suitable',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

/** The reject chips offered per type (Feature design). The database checks only that a code is one of six. */
export const REJECT_CHIPS: Readonly<Record<DocumentType, readonly RejectionCode[]>> = {
  profile_photo: ['document_unclear', 'photo_not_suitable'],
  id_front: ['document_unclear', 'document_expired', 'name_mismatch'],
  id_back: ['document_unclear', 'document_expired', 'name_mismatch'],
  selfie: ['document_unclear', 'selfie_mismatch'],
  criminal_record: ['document_unclear', 'criminal_record_invalid', 'document_expired', 'name_mismatch'],
  skill_certificate: ['document_unclear', 'document_expired', 'name_mismatch'],
};

/** The types admin dates on Match (AC-17). */
export const VALID_UNTIL_TYPES: readonly DocumentType[] = ['id_front', 'id_back', 'criminal_record'];
/** At most 15 years ahead. */
export const VALID_UNTIL_MAX_YEARS = 15;

/** The cards of step 2, in order. The ID is one card with two sides. */
export const DOCUMENT_CARDS = ['id', 'selfie', 'criminal_record', 'skill_certificate'] as const;
export type DocumentCard = (typeof DOCUMENT_CARDS)[number];

export const LIMITS = {
  bioMin: 30,
  bioMax: 600,
  yearsMax: 60,
  legalNameMin: 2,
  legalNameMax: 200,
  noteMax: 300,
  suspensionMin: 5,
  suspensionMax: 500,
} as const;

/**
 * Postgres `btrim(text)`: spaces only, at both ends. JS `trim()` also takes newlines and tabs, which the
 * database keeps, so the count would drift from what is stored.
 */
export function btrim(text: string): string {
  return text.replace(/^ +| +$/g, '');
}

/** Code points after `btrim`, as `char_length(btrim(...))` counts in the database (AC-1). */
export function bioLength(text: string): number {
  return [...btrim(text)].length;
}

const DIGIT_FOLD: Readonly<Record<string, string>> = Object.fromEntries(
  [...'٠١٢٣٤٥٦٧٨٩']
    .map((digit, index) => [digit, String(index)])
    .concat([...'۰۱۲۳۴۵۶۷۸۹'].map((digit, index) => [digit, String(index)])),
);

/**
 * A tax number as the database stores it: Arabic Indic and Persian digits folded, spaces and dashes
 * stripped (AC-2). The form uses it only to compare with the saved value before warning; the database
 * normalises on its own.
 */
export function normaliseTaxNumber(raw: string): string {
  return [...raw]
    .map((char) => DIGIT_FOLD[char] ?? char)
    .join('')
    .replace(/[\s ‐-―-]/g, '');
}

/** The pattern a tax number must match per region (D112): 10 digits in TR, 15 in KSA. */
export const TAX_NUMBER_DIGITS = { TR: 10, KSA: 15 } as const;

/** The admin queue (AC-14). */
export const QUEUE_TABS = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];
export const QUEUE_SORTS = ['oldest', 'newest'] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];
export const QUEUE_PAGE_SIZE = 20;
