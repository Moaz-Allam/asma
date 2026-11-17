import 'server-only';

import type { Db } from '@/lib/db/types';
import { raiseAlert } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import type { PspAdapter, RetrievePaymentResult } from '@/lib/psp';
import { isRegion, type Region } from '@/lib/region';

import { call } from './db';

/**
 * Reconciliation (spec 0011-08 AC-12, R-1, R-10, R-11, A-2). It catches anything stuck and compares our books
 * with the PSP's; it corrects nothing: every difference is an alert for the owner, until 16 adds an admin
 * correction.
 */

/** Every 15 minutes: queue checks for open and recently finished attempts, fail stuck ones, clear old IPs. */
export async function reconcilePending(db: Db): Promise<Record<string, number>> {
  return call<Record<string, number>>(db, 'reconcile_pending');
}

export const DAILY_CHUNK = 25;
export const DAILY_DEADLINE_MS = 40_000;

type DailyRow = {
  kind: 'fee' | 'late';
  ref_id: string;
  psp_payment_id: string;
  status: 'paid' | 'refunded';
  amount: number;
  currency: string;
  psp_fee_amount: number | null;
};

type RegionRow = { code: string; timezone: string | null; active: boolean };

/** The calendar day before `now` in a timezone, as YYYY-MM-DD. */
export function previousLocalDay(now: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date(now))
    .reduce<Record<string, number>>((out, part) => {
      if (part.type !== 'literal') out[part.type] = Number(part.value);
      return out;
    }, {});
  const { year = 1970, month = 1, day = 1 } = parts;
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * R-11: the run scheduled at 01:50 UTC is the day's last; it checks the books and what is left. A kick delayed
 * past 02:00 still counts, so a late run never skips the books check (review 2026-11-17).
 */
export function isLastDailyRun(now: number): boolean {
  const at = new Date(now);
  return (at.getUTCHours() === 1 && at.getUTCMinutes() >= 50) || at.getUTCHours() === 2;
}

/** R-14: what the PSP must say for one of our rows. Anything else, partially refunded included, alerts. */
export function dailyMismatch(row: DailyRow, psp: RetrievePaymentResult): boolean {
  if (psp.amount !== row.amount || psp.currency !== row.currency) return true;
  if (row.kind === 'fee' && row.status === 'paid') {
    return psp.status !== 'paid' || psp.pspFee !== row.psp_fee_amount;
  }
  if (psp.status !== 'refunded' || psp.refundedAmount !== row.amount) return true;
  return row.kind === 'fee' && psp.pspFee !== row.psp_fee_amount;
}

async function activeRegions(db: Db): Promise<{ region: Region; timeZone: string }[]> {
  const { data, error } = await db.from('regions').select('code, timezone, active');
  if (error || !Array.isArray(data)) throw new Error('regions_unreadable');
  return (data as RegionRow[])
    .filter((r) => r.active && isRegion(r.code) && typeof r.timezone === 'string')
    .map((r) => ({ region: r.code as Region, timeZone: r.timezone as string }));
}

/**
 * Every 10 minutes from 00:00 to 01:50 UTC (R-11): compare the previous local day's payments with the PSP, at
 * most 25 per run under a 40 second deadline, each recorded as a `reconcile:<day>:<psp_payment_id>` event so
 * the next run resumes. The last run checks the books and alerts anything still left.
 */
export async function reconcileDaily(
  db: Db,
  psp: PspAdapter,
  now: () => number = Date.now,
): Promise<{ compared: number; mismatched: number }> {
  const started = now();
  const out = { compared: 0, mismatched: 0 };
  for (const { region, timeZone } of await activeRegions(db)) {
    // A cut run does not start another region's compare (review 2026-11-17); the last run's checks still run.
    const late = now() - started > DAILY_DEADLINE_MS;
    const day = previousLocalDay(started, timeZone);
    const rows = late
      ? []
      : await call<DailyRow[]>(db, 'reconcile_daily_list', {
          p_region: region,
          p_day: day,
          p_limit: DAILY_CHUNK,
        });
    for (const row of rows) {
      if (now() - started > DAILY_DEADLINE_MS) break;
      let found: RetrievePaymentResult;
      try {
        found = await psp.retrievePayment(row.psp_payment_id);
      } catch {
        // Not recorded, so the next run tries it again; the last run alerts it as unfinished.
        log.warn('reconcile_cut', { request_id: row.ref_id, region });
        continue;
      }
      await call(db, 'record_psp_event', {
        p_source: 'reconcile',
        p_event_key: `reconcile:${day}:${row.psp_payment_id}`.slice(0, 200),
        p_payload: found.raw,
        p_region: region,
      });
      out.compared += 1;
      if (dailyMismatch(row, found)) {
        out.mismatched += 1;
        raiseAlert('reconcile_mismatch', { recordId: row.ref_id, region });
      }
    }

    if (isLastDailyRun(started)) {
      const left = await call<DailyRow[]>(db, 'reconcile_daily_list', {
        p_region: region,
        p_day: day,
        p_limit: 1,
      });
      if (left.length > 0)
        raiseAlert('reconcile_mismatch', { recordId: `${region}:${day}:unfinished`, region });
      const books = await call<{ imbalances?: { check: string; ref: string }[] }>(db, 'ledger_check', {
        p_region: region,
      });
      for (const imbalance of books.imbalances ?? []) {
        raiseAlert('ledger_unbalanced', {
          recordId: `${region}:${imbalance.check}:${imbalance.ref}`,
          region,
        });
      }
    }
  }
  return out;
}
