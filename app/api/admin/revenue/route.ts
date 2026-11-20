import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { loadRevenue, revenueCsv, revenueFileName } from '@/lib/admin-revenue';
import { REVENUE_GRAINS } from '@/lib/admin-revenue/schemas';
import { AuthRefusal, requireRole } from '@/lib/auth/session';
import { dayFrom } from '@/lib/format/day';
import { reportServerError } from '@/lib/observability/server';

/**
 * GET /api/admin/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD&grain=day|month (spec 0011-16 R-10, X-14, AC-7): the revenue
 * rows as CSV for the accountant. Admin only: `requireRole('admin')` first, and `admin_revenue` checks `is_admin()`
 * again. The same rows the page shows, through the same door; amounts as decimal text from minor units (rule 4).
 * Never cached. Spec 0011-21 adds the `aal2` check to every admin route.
 */

export const dynamic = 'force-dynamic';

const Query = z
  .object({
    from: z.string().transform((value, ctx) => dayFrom(value) ?? (ctx.addIssue({ code: 'custom' }), z.NEVER)),
    to: z.string().transform((value, ctx) => dayFrom(value) ?? (ctx.addIssue({ code: 'custom' }), z.NEVER)),
    grain: z.enum(REVENUE_GRAINS),
  })
  .strict();

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function refuse(status: number, code: string): Response {
  return Response.json({ error: code }, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await requireRole('admin');
  } catch (error) {
    if (error instanceof AuthRefusal) return refuse(error.code === 'unauthorized' ? 401 : 403, error.code);
    throw error;
  }

  const query = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return refuse(400, 'validation_failed');

  let outcome: Awaited<ReturnType<typeof loadRevenue>>;
  try {
    outcome = await loadRevenue(query.data);
  } catch (error) {
    reportServerError('adminRevenueCsv', error);
    return refuse(500, 'action_failed');
  }
  if (!outcome.ok) return refuse(outcome.code === 'forbidden' ? 403 : 400, outcome.code);

  return new Response(revenueCsv(outcome.report), {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${revenueFileName(outcome.report)}"`,
    },
  });
}
