import 'server-only';

import type { Db } from '@/lib/db/types';
import { raiseAlert, type AlertCause } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import type { Region } from '@/lib/region';

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

export const MONEY_FLAGS = [
  'funding_enabled',
  'unlock_enabled',
  'payouts_enabled',
  'auto_release_enabled',
  'notifications_enabled',
] as const;
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
