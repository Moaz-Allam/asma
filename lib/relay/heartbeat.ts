import 'server-only';

import type { Db } from '@/lib/db/types';
import { raiseAlert } from '@/lib/observability/alert';
import { isRegion } from '@/lib/region';

import { call } from './db';

/**
 * `heartbeat`, every 5 minutes (spec 0011-08 AC-13, R-12): alert `relay_stalled` when the oldest due row has
 * waited more than 5 minutes, and each row that ran out of tries once (`outbox_health` stamps it). A refund row
 * is marked failed first and alerts `refund_failed`, which also covers a refund `claim_outbox` failed with
 * `lease_expired`.
 */

export const STALLED_AFTER_SECONDS = 5 * 60;

type Health = {
  oldest_due_seconds: number;
  failed: { id: string; kind: string; region: string; payload: Record<string, unknown> }[];
};

export async function heartbeat(db: Db): Promise<{ stalled: boolean; failed: number }> {
  const health = await call<Health>(db, 'outbox_health');
  const stalled = health.oldest_due_seconds > STALLED_AFTER_SECONDS;
  if (stalled) raiseAlert('relay_stalled', { recordId: 'outbox' });
  for (const row of health.failed) {
    const region = isRegion(row.region) ? row.region : undefined;
    const refundId = row.payload.fee_refund_id;
    if (row.kind === 'refund.request' && typeof refundId === 'string') {
      try {
        await call(db, 'mark_refund_failed', { p_fee_refund_id: refundId });
      } catch {
        // Alerted below either way.
      }
      raiseAlert('refund_failed', { recordId: refundId, region });
    } else {
      raiseAlert('outbox_failed', { recordId: row.id, region });
    }
  }
  return { stalled, failed: health.failed.length };
}
