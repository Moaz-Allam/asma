import 'server-only';

import type { Db } from '@/lib/db/types';
import { log } from '@/lib/observability/log';

import { call } from './db';

/**
 * The browser back from the card page (spec 0011-08 AC-8, R-1). Store the fields and queue a check; change no
 * money state. Answers where to send the browser: the attempt's pay page, or home for an unknown token. The
 * token is never logged.
 */

export const CALLBACK_LIMIT_BYTES = 8 * 1024;

type Found = { attempt_id: string; locale: string; region: string } | null;

export async function handleCallback(db: Db, fields: Record<string, string>): Promise<string> {
  const token = fields.token;
  if (typeof token !== 'string' || token.length < 1 || token.length > 500) {
    log.warn('psp_callback_unknown');
    return '/';
  }
  try {
    const found = await call<Found>(db, 'psp_callback', { p_token: token, p_fields: fields });
    if (found === null) {
      log.warn('psp_callback_unknown');
      return '/';
    }
    const locale = ['ar', 'tr', 'en'].includes(found.locale) ? found.locale : 'tr';
    return `/${locale}/pay/${found.attempt_id}`;
  } catch {
    // reconcile_pending checks a ready attempt within 15 minutes anyway.
    log.error('relay_task_failed');
    return '/';
  }
}

/** A form body (application/x-www-form-urlencoded) as plain string fields. */
export function formFields(body: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(new TextDecoder().decode(body))) {
    if (key.length <= 100 && !(key in fields)) fields[key] = value;
  }
  return fields;
}
