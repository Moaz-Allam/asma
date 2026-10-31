import 'server-only';

import { z } from 'zod';

import { createAnonClient } from '@/lib/db/anon';

/** What a signed out visitor may know about the live regions (spec 0005 Value sourcing). */

const PublicRegionSchema = z.array(
  z.object({
    code: z.string(),
    dial_code: z.string(),
    support_whatsapp: z.string().nullable(),
  }),
);

export type PublicRegion = { code: string; dialCode: string; supportWhatsapp: string | null };

/** The active regions, read live: switching a region on is a data change (AC-3). */
export async function getPublicRegions(): Promise<PublicRegion[]> {
  const { data, error } = await createAnonClient().rpc('public_region_info');
  if (error) throw error;
  return PublicRegionSchema.parse(data).map((region) => ({
    code: region.code,
    dialCode: region.dial_code,
    supportWhatsapp: region.support_whatsapp,
  }));
}
