import 'server-only';

import { getEnv } from '@/lib/env';

/**
 * The MapTiler key (spec 0011-20b AC-10): public by design and locked to our domains in MapTiler (S46), read here only
 * (lint). A page passes it to the address form; without one the map button never shows and the typed fields work alone.
 */
export function mapKey(): string | null {
  const key = getEnv().NEXT_PUBLIC_MAPTILER_KEY;
  // Return null when the key is empty or undefined - map button won't show and typed fields work alone
  return key && key.length > 0 ? key : null;
}
