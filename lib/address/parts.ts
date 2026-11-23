import { z } from 'zod';

// This module runs in the browser too. Zod 4 probes `new Function("")` before its first object parse; our CSP
// refuses eval, and the browser reports the caught probe as a violation. Jitless skips the probe (and the JIT).
z.config({ jitless: true });

/**
 * The structured address (spec 0011-20b). Shared by the browser and the server, so no `server-only`: the form checks
 * the same rules Postgres checks (`address_parse`) to show a message early, but Postgres is the check (AC-3). The
 * keys are the database's (`p_address`), snake case, so nothing is renamed on the way.
 */

export const ADDRESS_TEXT_KEYS = [
  'il',
  'ilce',
  'mahalle',
  'street',
  'building_no',
  'floor',
  'apartment',
  'postal_code',
  'directions',
] as const;
export type AddressTextKey = (typeof ADDRESS_TEXT_KEYS)[number];

/** The parts a customer types: il and ilçe come from the zone, never from the form (AC-2). */
export const REQUEST_ADDRESS_KEYS = [
  'mahalle',
  'street',
  'building_no',
  'floor',
  'apartment',
  'postal_code',
  'directions',
] as const satisfies readonly AddressTextKey[];
/** The parts a provider types (AC-5): il and ilçe, no directions. */
export const PROVIDER_ADDRESS_KEYS = [
  'il',
  'ilce',
  'mahalle',
  'street',
  'building_no',
  'floor',
  'apartment',
  'postal_code',
] as const satisfies readonly AddressTextKey[];

/** Code point limits, as the table checks hold them (`address_part_ok`). */
export const ADDRESS_LIMITS: Readonly<Record<AddressTextKey, { min: number; max: number }>> = {
  il: { min: 2, max: 60 },
  ilce: { min: 2, max: 60 },
  mahalle: { min: 2, max: 80 },
  street: { min: 2, max: 80 },
  building_no: { min: 1, max: 10 },
  floor: { min: 1, max: 10 },
  apartment: { min: 1, max: 10 },
  postal_code: { min: 5, max: 5 },
  directions: { min: 1, max: 300 },
};

const NUMBER_PARTS: ReadonlySet<AddressTextKey> = new Set(['building_no', 'floor', 'apartment']);
const NUMBER_PART = /^[0-9A-Za-zÇĞİÖŞÜçğıöşü./ -]+$/;
const POSTAL_CODE = /^[0-9]{5}$/;
// Control characters plus Unicode format characters (soft hyphen, Arabic letter mark, zero width, separators, bidi, BOM), as Postgres refuses them (S20b-3).
const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff\ufff9-\ufffb]/;
const EDGE_SPACE = /^[\s ­​-‏⁠﻿]+|[\s ­​-‏⁠﻿]+$/g;

/** The region's pin box (`address_pin_in_region`). Only TR has one. */
export const PIN_BOX = { minLat: 35.5, maxLat: 42.5, minLng: 25.5, maxLng: 45.0 } as const;

export type AddressDraft = Partial<Record<AddressTextKey, string>> & {
  lat?: number | null;
  lng?: number | null;
};

/** What the database stores for one part: trimmed, an empty string none. */
export function cleanPart(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.replace(EDGE_SPACE, '');
  return trimmed === '' ? null : trimmed;
}

const codePoints = (value: string) => [...value].length;

/** Six decimals at most (about 0.1 m), the stored precision. */
export function roundPin(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function pinInTurkey(lat: number, lng: number): boolean {
  return lat >= PIN_BOX.minLat && lat <= PIN_BOX.maxLat && lng >= PIN_BOX.minLng && lng <= PIN_BOX.maxLng;
}

export type AddressError = 'address_invalid' | 'pin_invalid';
export type AddressErrors = Partial<Record<AddressTextKey | 'pin', AddressError>>;

/**
 * The form's own check, one code per part (X-21): required parts, lengths, the number formats, the postal code and
 * the pin. The contact scanner runs only in Postgres; its refusal comes back as `contact_info_in_address`.
 */
export function addressErrors(draft: AddressDraft, keys: readonly AddressTextKey[]): AddressErrors {
  const errors: AddressErrors = {};
  const required: AddressTextKey[] = ['mahalle', 'street', 'building_no'];
  if (keys.includes('il')) required.push('il', 'ilce');
  for (const key of keys) {
    const value = cleanPart(draft[key]);
    if (value === null) {
      if (required.includes(key)) errors[key] = 'address_invalid';
      continue;
    }
    const { min, max } = ADDRESS_LIMITS[key];
    const length = codePoints(value);
    if (length < min || length > max || CONTROL.test(value)) errors[key] = 'address_invalid';
    else if (key === 'postal_code' && !POSTAL_CODE.test(value)) errors[key] = 'address_invalid';
    else if (NUMBER_PARTS.has(key) && (!NUMBER_PART.test(value) || value.replace(/[^0-9]/g, '').length > 4))
      errors[key] = 'address_invalid';
  }
  const hasLat = typeof draft.lat === 'number';
  const hasLng = typeof draft.lng === 'number';
  if (hasLat !== hasLng) errors.pin = 'pin_invalid';
  else if (hasLat && hasLng && !pinInTurkey(draft.lat as number, draft.lng as number))
    errors.pin = 'pin_invalid';
  return errors;
}

/** The body sent as `p_address`: only the given keys, trimmed strings or null, and the pin rounded. */
export function addressPayload(
  draft: AddressDraft,
  keys: readonly AddressTextKey[],
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const key of keys) out[key] = cleanPart(draft[key]);
  if (typeof draft.lat === 'number' && typeof draft.lng === 'number') {
    out.lat = roundPin(draft.lat);
    out.lng = roundPin(draft.lng);
  }
  return out;
}

/**
 * The same line Postgres composes (`compose_address`), for the review step before posting only; every stored line is
 * Postgres's own. `<mahalle> Mah.`, `<street>`, `No: <n>`, `Kat: <n>`, `Daire: <n>`, `<postal> <ilçe>/<il>`.
 */
export function composeAddress(parts: Partial<Record<AddressTextKey, string | null>>): string {
  const part = (key: AddressTextKey) => cleanPart(parts[key] ?? null);
  const mahalle = part('mahalle');
  const building = part('building_no');
  const floor = part('floor');
  const apartment = part('apartment');
  const place = [part('ilce'), part('il')].filter(Boolean).join('/');
  return [
    mahalle === null ? null : /(mah\.|mahallesi|mh\.)$/i.test(mahalle) ? mahalle : `${mahalle} Mah.`,
    part('street'),
    building && `No: ${building}`,
    floor && `Kat: ${floor}`,
    apartment && `Daire: ${apartment}`,
    [part('postal_code'), place || null].filter(Boolean).join(' ') || null,
  ]
    .filter((x): x is string => Boolean(x))
    .join(', ');
}

/**
 * A fold for the browser's ilçe mismatch note only (X-15): marks stripped (so `İ` and `ş` compare as `i` and `s`), the
 * dotless `ı` read as `i`, and a plain, locale free lower case. Never an identifier, never stored, never on the server.
 */
export function placeFold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().trim();
}

// ── The action inputs (strict shapes; Postgres checks the values) ─────────────

const Part = z.string().max(400).nullable();
const Pin = z.number().finite().min(-180).max(180);

export const RequestAddressInput = z
  .object({
    mahalle: Part,
    street: Part,
    building_no: Part,
    floor: Part,
    apartment: Part,
    postal_code: Part,
    directions: Part,
    lat: Pin.optional(),
    lng: Pin.optional(),
  })
  .strict();
export type RequestAddressInput = z.infer<typeof RequestAddressInput>;

export const ProviderAddressInput = z
  .object({
    il: Part,
    ilce: Part,
    mahalle: Part,
    street: Part,
    building_no: Part,
    floor: Part,
    apartment: Part,
    postal_code: Part,
    lat: Pin.optional(),
    lng: Pin.optional(),
  })
  .strict();
export type ProviderAddressInput = z.infer<typeof ProviderAddressInput>;

const Nullable = z.string().nullable().optional();

/** An address as a reader gets it (the request page, the contact card, admin). Every part may be null (AC-9). */
export const StoredAddress = z.object({
  line: Nullable,
  il: Nullable,
  ilce: Nullable,
  mahalle: Nullable,
  street: Nullable,
  building_no: Nullable,
  floor: Nullable,
  apartment: Nullable,
  postal_code: Nullable,
  directions: Nullable,
  lat: z.coerce.number().nullable().optional(),
  lng: z.coerce.number().nullable().optional(),
});
export type StoredAddress = z.infer<typeof StoredAddress>;

/** The Open in Maps link (AC-6, X-5): coordinates only when pinned, else a search for the line. */
export function openInMapsUrl(address: {
  lat?: number | null;
  lng?: number | null;
  line?: string | null;
}): string | null {
  if (typeof address.lat === 'number' && typeof address.lng === 'number') {
    return `https://www.google.com/maps/search/?api=1&query=${address.lat},${address.lng}`;
  }
  if (address.line)
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.line)}`;
  return null;
}
