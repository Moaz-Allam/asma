import 'server-only';

import { cache } from 'react';
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

/**
 * The active regions, read live: switching a region on is a data change (AC-3). One read per render. An
 * outage answers an empty list: the public pages still draw, and `/login` says sign in is unavailable.
 */
export const getPublicRegions = cache(async (): Promise<PublicRegion[]> => {
  try {
    const { data, error } = await createAnonClient().rpc('public_region_info');
    if (error) return [];
    return PublicRegionSchema.parse(data).map((region) => ({
      code: region.code,
      dialCode: region.dial_code,
      supportWhatsapp: region.support_whatsapp,
    }));
  } catch {
    return [];
  }
});
