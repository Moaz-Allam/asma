import 'server-only';

import { z } from 'zod';

import { DOCUMENT_TYPES } from '@/lib/storage/buckets';
import { IdSchema } from '@/lib/validation';

import { ENTITY_TYPES, LIMITS, PROVIDER_LANGUAGES, REJECTION_CODES } from './options';

/**
 * The Server Action inputs of position 02 (spec 0006). Shapes only: the database functions hold every
 * rule that matters (lengths after trim, the tax number per region, the scanner), so a direct call gets
 * the same refusals as the form. These stop a malformed call before it costs a round trip.
 */

export const ProviderProfileSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  legalName: z.string().max(400).nullable(),
  taxNumber: z.string().max(60).nullable(),
  bio: z.string().max(LIMITS.bioMax * 4),
  years: z.number().int(),
  languages: z.array(z.enum(PROVIDER_LANGUAGES)).min(1).max(PROVIDER_LANGUAGES.length),
});

export const RegisterDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  path: z.string().min(1).max(300),
});

export const ReviewDocumentsSchema = z.object({
  providerId: IdSchema,
  ids: z.array(IdSchema).min(1).max(2),
  objectIds: z.array(IdSchema).min(1).max(2),
  verdict: z.enum(['approved', 'rejected']),
  code: z.enum(REJECTION_CODES).nullable(),
  note: z
    .string()
    .max(LIMITS.noteMax * 2)
    .nullable(),
  // A plain date, as admin typed it. The database compares it with current_date.
  validUntil: z.iso.date().nullable(),
});

export const DecideProviderSchema = z.object({
  providerId: IdSchema,
  decision: z.enum(['approved', 'rejected']),
  // providers.updated_at as the page rendered it, sent back unchanged.
  seenUpdatedAt: z.string().min(10).max(40),
  code: z.enum(REJECTION_CODES).nullable(),
  note: z
    .string()
    .max(LIMITS.noteMax * 2)
    .nullable(),
});

export const SuspendProviderSchema = z.object({
  providerId: IdSchema,
  reason: z.string().max(LIMITS.suspensionMax * 2),
});

export const ProviderIdSchema = z.object({ providerId: IdSchema });

export const ShowDocumentSchema = z.object({ documentId: IdSchema, objectId: IdSchema });
