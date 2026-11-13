/**
 * Sample values for the landing page, as drawn in `s1` (D101, spec 0005 AC-28): an owner override of
 * `ui-rules.md` §11, for these landing sections only. Position 03 replaces them with catalog data, and
 * `npm run launch:gate` fails while `SAMPLE_DATA` is true. Every amount is integer minor units.
 */

export const SAMPLE_DATA = true;

/**
 * The files in `public/landing/` are the design's borrowed photos, kept for now on the owner's word (D109, Q12).
 * Set this to false when owned photos replace them: `npm run launch:gate` fails until then.
 */
export const BORROWED_PHOTOS = true;

export const SAMPLE_CURRENCY = 'TRY';

export const SAMPLE_PRICES = [
  { key: 'oneRoom', amount: 180_000, note: 'hours3', featured: false },
  { key: 'twoRooms', amount: 220_000, note: 'hours4', featured: false },
  { key: 'threeRooms', amount: 280_000, note: 'mostRequested', featured: true },
  { key: 'fourRooms', amount: 350_000, note: 'hours7', featured: false },
] as const;

export const SAMPLE_ADDONS = [
  { key: 'windows', amount: 40_000 },
  { key: 'ironing', amount: 50_000 },
  { key: 'oven', amount: 60_000 },
  { key: 'deep', amount: 70_000 },
] as const;

/** The job price on the sample payment card in How it works. */
export const SAMPLE_JOB_PRICE = 320_000;

export const SAMPLE_CATEGORIES = ['home', 'deep', 'windows', 'carpets', 'other'] as const;

export const SAMPLE_SERVICES = [
  'regular',
  'deep',
  'windows',
  'ironing',
  'oven',
  'carpets',
  'ac',
  'moveOut',
] as const;
