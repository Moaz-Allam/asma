import 'server-only';

/**
 * Region resolution. See context/architecture.md §4 (Regions) and decision D14.
 *
 * Both markets run from ONE deployment, separated by a `region` column. Region is
 * therefore a property of the row being processed — a request, a provider — and
 * never a deployment-wide constant.
 *
 * An account belongs to exactly one region, so one account means one currency and
 * every posting group is single-currency by construction.
 */

export const REGIONS = ['TR', 'KSA'] as const;
export type Region = (typeof REGIONS)[number];

export type Currency = 'TRY' | 'SAR';
export type PspProvider = 'iyzico' | 'paytabs';

/**
 * Static facts per region.
 *
 * ⚠️ The `regions` TABLE is the source of truth. This mirrors it, field for field,
 * for code that needs the mapping before it can run a query — choosing which PSP
 * adapter to construct, validating a dialling code at signup. A pgTAP test and a
 * unit test assert the two match; if they ever diverge, the table wins and this
 * constant is the bug.
 *
 * `active` is deliberately absent here: deactivating a region is a runtime state
 * question that must be read live, never from a compiled-in constant.
 */
export type RegionFacts = {
  currency: Currency;
  psp: PspProvider;
  /** D16 — a TR account uses +90, a KSA account +966. Enforced at signup. */
  dialCode: string;
  /** The locale a new account in this region STARTS in. Not a URL rule (D19). */
  defaultLocale: string;
};

export const REGION_CONFIG: Readonly<Record<Region, RegionFacts>> = {
  TR: { currency: 'TRY', psp: 'iyzico', dialCode: '+90', defaultLocale: 'tr' },
  KSA: { currency: 'SAR', psp: 'paytabs', dialCode: '+966', defaultLocale: 'ar' },
} as const;

export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value);
}

/** Read the region off a row. This is the only sanctioned way to obtain one. */
export function getRegion(row: { region: unknown }): Region {
  if (!isRegion(row.region)) {
    throw new Error(`Row has no valid region (got ${String(row.region)}). Expected TR or KSA.`);
  }
  return row.region;
}

export function currencyFor(region: Region): Currency {
  return REGION_CONFIG[region].currency;
}

/**
 * D16 — the phone's dialling code must match the account's region. This is what
 * makes "one account per region" workable under phone-based OTP, where one number
 * maps to one identity: the same person in both markets genuinely holds a
 * different number in each. No override at launch.
 */
export function phoneMatchesRegion(phone: string, region: Region): boolean {
  return phone.replace(/[\s-]/g, '').startsWith(REGION_CONFIG[region].dialCode);
}

/**
 * Guard against the pre-D14 model creeping back. Any code reaching for an
 * environment variable to decide region is reading a constant that does not
 * exist, and would silently mis-scope every query.
 */
export function regionFromEnv(): never {
  throw new Error(
    'Region is a column on the owning row, not an environment variable (D14). ' +
      'Use getRegion(row). See context/architecture.md §4 (Regions).',
  );
}
