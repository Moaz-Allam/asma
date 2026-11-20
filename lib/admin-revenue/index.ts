import 'server-only';

import { createSupabaseServer } from '@/lib/db/server';

import { RevenueReport, type RevenueGrain } from './schemas';

/**
 * Admin's one door to revenue (spec 0011-16 R-9 to R-11): the ledger summed in Postgres by `admin_revenue`, which
 * checks `is_admin()` again. No amount is ever sent or computed here. The page and the CSV route read the same rows.
 */

export { revenueCsv, revenueFileName } from './csv';
export type { RevenueReport, RevenueRow } from './schemas';

/** The codes `admin_revenue` raises. */
export const REVENUE_DB_CODES = ['forbidden', 'validation_failed'] as const;
export type RevenueCode = (typeof REVENUE_DB_CODES)[number];

/** Revenue by day or month for an inclusive range (R-9, X-12); a refused range comes back as its code. */
export async function loadRevenue(input: {
  from: string;
  to: string;
  grain: RevenueGrain;
}): Promise<{ ok: true; report: RevenueReport } | { ok: false; code: RevenueCode }> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc('admin_revenue', {
    p_from: input.from,
    p_to: input.to,
    p_grain: input.grain,
  });
  if (error) {
    const code = (REVENUE_DB_CODES as readonly string[]).includes(error.message)
      ? (error.message as RevenueCode)
      : null;
    if (code) return { ok: false, code };
    throw error;
  }
  return { ok: true, report: RevenueReport.parse(data) };
}
