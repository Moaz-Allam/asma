import 'server-only';

import type { Db } from '@/lib/db/types';
import { log } from '@/lib/observability/log';
import { isPspError, type PspAdapter } from '@/lib/psp';

import { call } from './db';

/**
 * The PSP's server message (spec 0011-08 AC-9, R-15). Verified against the raw body, then stored and, when it
 * names an attempt, a check is queued. Changes no money state. Answers the HTTP status for the route.
 */

export const WEBHOOK_LIMIT_BYTES = 64 * 1024;

export async function handleWebhook(
  db: Db,
  psp: PspAdapter,
  rawBody: string,
  headers: Headers,
): Promise<number> {
  let event: Awaited<ReturnType<PspAdapter['verifyWebhook']>>;
  try {
    event = await psp.verifyWebhook({ rawBody, headers });
  } catch (error) {
    if (isPspError(error) && error.code === 'psp_not_configured') return 503;
    log.warn('psp_webhook_invalid');
    return 401;
  }
  try {
    await call(db, 'psp_webhook', {
      p_event_key: event.eventKey,
      p_token: event.token,
      p_psp_payment_id: event.pspPaymentId,
      p_payload: event.payload,
      p_home_region: psp.homeRegion,
    });
    return 200;
  } catch {
    // The PSP sends it again.
    log.error('relay_task_failed');
    return 500;
  }
}
