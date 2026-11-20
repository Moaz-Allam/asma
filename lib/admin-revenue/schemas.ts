import { z } from 'zod';

/**
 * What `admin_revenue()` returns (spec 0011-16 R-9, X-11, X-12). Strict: a key the function starts sending by mistake
 * fails the parse. Every amount is integer minor units, summed in Postgres; nothing here adds or rounds.
 */

const Minor = z.number().int();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const REVENUE_GRAINS = ['day', 'month'] as const;
export type RevenueGrain = (typeof REVENUE_GRAINS)[number];

/** The amount columns, in the order the page and the CSV show them. */
export const REVENUE_COLUMNS = [
  'commission_revenue',
  'provider_fee_revenue',
  'commission_refunds',
  'provider_fee_refunds',
  'psp_fees',
  'net',
  'late_received',
  'late_refunded',
] as const;

const Row = z
  .object({
    region: z.enum(['TR', 'KSA']),
    currency: z.enum(['TRY', 'SAR']),
    bucket: Day,
    commission_revenue: Minor,
    provider_fee_revenue: Minor,
    commission_refunds: Minor,
    provider_fee_refunds: Minor,
    psp_fees: Minor,
    net: Minor,
    late_received: Minor,
    late_refunded: Minor,
  })
  .strict();

export const RevenueReport = z
  .object({ from: Day, to: Day, grain: z.enum(REVENUE_GRAINS), rows: z.array(Row) })
  .strict();
export type RevenueReport = z.infer<typeof RevenueReport>;
