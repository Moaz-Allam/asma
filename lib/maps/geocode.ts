import { mapForward, mapReverse, type Candidate, type GeocodedParts } from './mapping';

/**
 * Geocoding from the browser (spec 0011-20b AC-4, AC-10): MapTiler is called here only, never from our server (rule
 * 3's spirit). The client library loads on first use, so it never sits in a page's first bundle. Any failure throws;
 * the caller shows `map_unavailable` and the typed fields keep working.
 */

async function client(key: string) {
  const maptiler = await import('@maptiler/client');
  maptiler.config.apiKey = key;
  return maptiler;
}

/** Up to five places in Turkey for a typed search, in Turkish, nearest the given point first. */
export async function forwardGeocode(
  key: string,
  query: string,
  near?: { lat: number; lng: number },
): Promise<Candidate[]> {
  const maptiler = await client(key);
  const answer = await maptiler.geocoding.forward(query, {
    country: ['tr'],
    language: ['tr'],
    limit: 5,
    ...(near ? { proximity: [near.lng, near.lat] as [number, number] } : {}),
  });
  return mapForward(answer);
}

/** The parts MapTiler names for one point. */
export async function reverseGeocode(key: string, lat: number, lng: number): Promise<GeocodedParts> {
  const maptiler = await client(key);
  const answer = await maptiler.geocoding.reverse([lng, lat], { language: ['tr'] });
  return mapReverse(answer);
}

export type { Candidate, GeocodedParts };
