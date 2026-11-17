import 'server-only';

import type { Db } from '@/lib/db/types';
import { raiseAlert, type AlertCause } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import { isRegion, type Region } from '@/lib/region';

/**
 * The money kill switches (spec 0004 AC-14, D70; architecture.md §38). Each flag is a
 * `platform_settings` row per region, read live on every call, so flipping the row in the table editor
 * (until the admin UI, 16) acts on the next read with no deploy.
 *
 * A flag FAILS CLOSED: a read error, a timeout, a missing or hidden row (the anonymous client sees
 * none), or a value that is not a JSON boolean all return `false`, log `flag_read_failed`, and raise
 * the `flag_read_failed` alert for record `region:flag`. A money feature that cannot prove it is on is
 * off. The database refuses a non boolean under an `_enabled` key as well.
 */

// 07 deleted the four escrow flags with the escrow model (D95, spec 0011-07 AC-15); one is left.
export const MONEY_FLAGS = ['notifications_enabled'] as const;
export type MoneyFlag = (typeof MONEY_FLAGS)[number];

export const FLAG_READ_TIMEOUT_MS = 2000;

type Read = { value: boolean } | { cause: AlertCause };

async function read(flag: MoneyFlag, region: Region, db: Db): Promise<Read> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Read>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ cause: 'timeout' });
    }, FLAG_READ_TIMEOUT_MS);
  });
  const query = (async (): Promise<Read> => {
    const { data, error } = await db
      .from('platform_settings')
      .select('value')
      .eq('region', region)
      .eq('key', flag)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (error) return { cause: controller.signal.aborted ? 'timeout' : 'error' };
    if (data === null) return { cause: 'missing' };
    return typeof data.value === 'boolean' ? { value: data.value } : { cause: 'not_boolean' };
  })();
  try {
    return await Promise.race([query, timedOut]);
  } catch {
    return { cause: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this money feature on in this region? `region` comes from the owning row, never from the client
 * (rule 10); `db` is the caller's client, a signed in session or a job's admin client, whose RLS
 * decides what it may read. Never throws.
 */
export async function isEnabled(flag: MoneyFlag, region: Region, db: Db): Promise<boolean> {
  // A caller's bug, not a failed read: off, logged, and no alert, so a bad value can never open a new
  // Sentry issue (and an owner email) per value it takes (review 2026-10-29).
  if (!isRegion(region) || !(MONEY_FLAGS as readonly string[]).includes(flag)) {
    log.error('flag_read_failed');
    return false;
  }
  let result: Read;
  try {
    result = await read(flag, region, db);
  } catch {
    result = { cause: 'error' };
  }
  if ('value' in result) return result.value;
  log.error('flag_read_failed', { region });
  raiseAlert('flag_read_failed', { recordId: `${region}:${flag}`, region, cause: result.cause });
  return false;
}
