import { z } from 'zod';

import { REGIONS } from '@/lib/region';
import { LOCALES } from '@/lib/i18n/direction';

/**
 * Shared Zod primitives. One schema per boundary lives beside its boundary; this
 * file holds only the pieces reused across them.
 *
 * code-standards.md §6 — the server ALWAYS re-parses. Client validation is UX.
 */

export const LocaleSchema = z.enum(LOCALES);
export const RegionSchema = z.enum(REGIONS);

/** UUID primary keys, as used by every domain table. */
export const IdSchema = z.uuid();

/**
 * E.164. The dialling-code-matches-region rule (D16) is enforced where the region
 * is known — see `phoneMatchesRegion` in lib/region — because this schema alone
 * cannot see which account is being created.
 */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164, e.g. +905551234567');

/**
 * Integer minor units crossing a boundary. Rule 4: never a float, and never
 * negative on an inbound amount — a refund is a separate operation, not a
 * negative charge.
 */
export const MinorUnitsSchema = z.number().int('Money must be an integer in minor units').nonnegative();

/** A localised label: the default locale is required, the others optional. */
export const LocalisedTextSchema = z
  .object({ ar: z.string().min(1), tr: z.string().optional(), en: z.string().optional() })
  .strict();

export type LocalisedText = z.infer<typeof LocalisedTextSchema>;
