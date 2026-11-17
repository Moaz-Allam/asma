import 'server-only';

import { createSupabaseAdmin } from '@/lib/db/admin';
import type { Db } from '@/lib/db/types';

/**
 * The relay's database access (spec 0011-08 AC-0, AC-20). Only service role functions: 07 gave no role any
 * money table access, so every relay read and write is one of them. A refusal comes back as its stable code.
 */

export function relayDb(): Db {
  return createSupabaseAdmin() as unknown as Db;
}

/** The stable codes the money functions raise (07, 08). Anything else is `db_error`. */
const KNOWN = [
  'not_found',
  'validation_failed',
  'invalid_state',
  'idempotency_conflict',
  'payload_too_large',
  'forbidden',
  'journal_invalid',
  'fake_payment_refused',
  // Spec 0011-09 R-2: a setting 09's accept check or transition reads is missing; verifyPayment alerts and retries.
  'checkout_settings_invalid',
  'unlock_settings_invalid',
] as const;

export type DbCode = (typeof KNOWN)[number] | 'db_error';

/** AC-19: a 07 function refused; the row retries by the schedule and alerts on its first and its last try. */
export const ALERTING_CODES: readonly DbCode[] = [
  'idempotency_conflict',
  'validation_failed',
  'not_found',
  'invalid_state',
];

export class RelayDbError extends Error {
  readonly code: DbCode;
  readonly fn: string;

  constructor(fn: string, code: DbCode) {
    super(`${fn}: ${code}`);
    this.name = 'RelayDbError';
    this.fn = fn;
    this.code = code;
  }
}

export function codeOf(message: string | undefined): DbCode {
  const text = (message ?? '').trim();
  return (KNOWN as readonly string[]).includes(text) ? (text as DbCode) : 'db_error';
}

/** One database function call. Throws `RelayDbError` with the function's stable code. */
export async function call<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new RelayDbError(fn, codeOf(error.message));
  return data as T;
}
