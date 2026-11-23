import { ADDRESS_LIMITS, cleanPart, type AddressTextKey } from '@/lib/address/parts';

/**
 * MapTiler's geocoding answers, read into our address parts (spec 0011-20b, Geocoder mapping, X-17). Pure, so it is
 * unit tested against saved responses. Only the fields named here are read; nothing else from a response is kept.
 *
 * A reverse answer is a FeatureCollection with at most one feature per place type, each with its `context` (the
 * hierarchy above it, each entry's `id` prefixed with its type, `neighbourhood.123`). The types we read, in order of
 * preference when more than one is present:
 */
export const PLACE_TYPES = {
  // Recorded 2026-11-23 (tests/fixtures/maptiler): in Turkey MapTiler names the mahalle `municipal_district`, the
  // ilçe `joint_municipality` and the il `county`; `region` is the geographic region (Marmara Bölgesi), never the il.
  mahalle: ['municipal_district', 'neighbourhood'],
  street: ['road'],
  postal_code: ['postal_code'],
  ilce: ['joint_municipality', 'municipality'],
  il: ['county'],
} as const;

type Hierarchy = { id?: unknown; text?: unknown; place_type?: unknown };
type Feature = Hierarchy & {
  address?: unknown;
  context?: unknown;
  center?: unknown;
  place_name?: unknown;
};

export type GeocodedParts = Partial<
  Record<'mahalle' | 'street' | 'building_no' | 'postal_code' | 'ilce' | 'il', string>
>;

export type Candidate = { id: string; label: string; lat: number; lng: number };

function typeOf(entry: Hierarchy): string | null {
  if (Array.isArray(entry.place_type) && typeof entry.place_type[0] === 'string') return entry.place_type[0];
  if (typeof entry.id === 'string' && entry.id.includes('.')) return entry.id.split('.')[0] ?? null;
  return null;
}

function text(entry: Hierarchy | undefined): string | null {
  return entry && typeof entry.text === 'string' ? entry.text : null;
}

/** Trimmed and cut to the column's limit (in code points), or nothing. */
function fit(value: string | null, key: AddressTextKey): string | undefined {
  const clean = cleanPart(value);
  if (clean === null) return undefined;
  const cut = [...clean].slice(0, ADDRESS_LIMITS[key].max).join('');
  return cleanPart(cut) ?? undefined;
}

function features(collection: unknown): Feature[] {
  if (!collection || typeof collection !== 'object') return [];
  const list = (collection as { features?: unknown }).features;
  return Array.isArray(list) ? list.filter((f): f is Feature => !!f && typeof f === 'object') : [];
}

/** One reverse answer as the parts it names. A part the geocoder did not return is absent, so the form keeps its own. */
export function mapReverse(collection: unknown): GeocodedParts {
  const byType = new Map<string, Hierarchy>();
  let address: Feature | undefined;
  for (const feature of features(collection)) {
    const type = typeOf(feature);
    if (type === 'address' && !address) address = feature;
    if (type && !byType.has(type)) byType.set(type, feature);
    const context = Array.isArray(feature.context) ? feature.context : [];
    for (const entry of context) {
      if (!entry || typeof entry !== 'object') continue;
      const t = typeOf(entry as Hierarchy);
      if (t && !byType.has(t)) byType.set(t, entry as Hierarchy);
    }
  }
  const first = (types: readonly string[]) => {
    for (const t of types) {
      const found = text(byType.get(t));
      if (found) return found;
    }
    return null;
  };
  const out: GeocodedParts = {};
  const street = fit(text(address) ?? first(PLACE_TYPES.street), 'street');
  const building = fit(typeof address?.address === 'string' ? address.address : null, 'building_no');
  const postal = fit(first(PLACE_TYPES.postal_code), 'postal_code');
  const mahalle = fit(first(PLACE_TYPES.mahalle), 'mahalle');
  const ilce = fit(first(PLACE_TYPES.ilce), 'ilce');
  const il = fit(first(PLACE_TYPES.il), 'il');
  if (mahalle) out.mahalle = mahalle;
  if (street) out.street = street;
  // A building number keeps the database's format, or is left for the customer to type.
  if (
    building &&
    /^[0-9A-Za-zÇĞİÖŞÜçğıöşü./ -]+$/.test(building) &&
    building.replace(/[^0-9]/g, '').length <= 4
  )
    out.building_no = building;
  if (postal && /^[0-9]{5}$/.test(postal)) out.postal_code = postal;
  if (ilce) out.ilce = ilce;
  if (il) out.il = il;
  return out;
}

/** A forward answer as at most five candidates with a point each. */
export function mapForward(collection: unknown): Candidate[] {
  const out: Candidate[] = [];
  for (const feature of features(collection)) {
    const center = feature.center;
    if (!Array.isArray(center) || typeof center[0] !== 'number' || typeof center[1] !== 'number') continue;
    const label = typeof feature.place_name === 'string' ? feature.place_name : (text(feature) ?? null);
    if (!label) continue;
    out.push({
      id: typeof feature.id === 'string' ? feature.id : `${center[0]},${center[1]}`,
      label: [...label].slice(0, 200).join(''),
      lng: center[0],
      lat: center[1],
    });
    if (out.length === 5) break;
  }
  return out;
}
