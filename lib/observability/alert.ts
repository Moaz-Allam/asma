import 'server-only';

import { captureMessage, getClient, withScope } from '@sentry/nextjs';

import { appEnv } from '@/lib/deployment';
import { flushSoon } from '@/lib/observability/server';
import type { Region } from '@/lib/region';

/**
 * `raiseAlert` (spec 0004 AC-11, D67): one Sentry event tagged `alert`, fingerprinted by reason, record
 * id and environment, so repeats for the same record join one issue, and a preview alert never hides
 * the first production one inside an existing issue (D84). Two Sentry alert rules (production only)
 * email the owner: one on a new or returning alert issue, one when an issue passes 10 events in 15
 * minutes (D80).
 *
 * The send is flushed with `after()` before the function freezes. Never throws; without the SDK it
 * mirrors to the console.
 */

/** Every alert reason. 00b defines the first; each money position adds its own. */
export type AlertReason = 'flag_read_failed';

export type AlertCause = 'error' | 'missing' | 'not_boolean' | 'timeout';

export type AlertDetail = {
  /** The record the alert is about, such as `TR:funding_enabled`. An internal id, never personal data. */
  recordId: string;
  region?: Region;
  cause?: AlertCause;
};

export function raiseAlert(reason: AlertReason, detail: AlertDetail): void {
  try {
    if (getClient() === undefined) {
      console.error(JSON.stringify({ alert: reason, ...detail }));
      return;
    }
    withScope((scope) => {
      scope.setTag('alert', reason);
      if (detail.region !== undefined) scope.setTag('region', detail.region);
      if (detail.cause !== undefined) scope.setTag('cause', detail.cause);
      scope.setFingerprint(['alert', reason, detail.recordId, appEnv(process.env)]);
      captureMessage(`alert ${reason}`, 'error');
    });
    flushSoon();
  } catch {
    // An alert that cannot be raised must never break the request that raised it.
  }
}
