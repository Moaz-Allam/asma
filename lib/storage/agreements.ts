import 'server-only';

import { createHash } from 'node:crypto';

import type { Db } from '@/lib/db/types';

import { AGREEMENTS_BUCKET } from './buckets';

/**
 * The service agreement files (spec 0011-20 AC-6, AC-8, X-2). The relay passes its own database handle: this door never
 * imports the service role itself (the `lib/db/admin` lint fence holds). An upload never overwrites (`upsert: false`,
 * and the bucket's guard refuses any update or delete for every role). Nothing here logs a path or a byte.
 */

export type UploadOutcome =
  { ok: true; existed: boolean } | { ok: false; code: 'upload_failed' | 'exists_differs' };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Uploads one agreement PDF. An "already exists" answer (a retry after a lost reply) counts as done only when the
 * stored object's SHA256 equals the new one.
 */
export async function uploadAgreement(db: Db, path: string, bytes: Uint8Array): Promise<UploadOutcome> {
  const bucket = db.storage.from(AGREEMENTS_BUCKET);
  const { error } = await bucket.upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (!error) return { ok: true, existed: false };
  const status =
    (error as { statusCode?: string | number; status?: number }).statusCode ??
    (error as { status?: number }).status;
  const exists = String(status) === '409' || /exists|duplicate/i.test(error.message ?? '');
  if (!exists) return { ok: false, code: 'upload_failed' };
  const stored = await bucket.download(path);
  if (stored.error || !stored.data) return { ok: false, code: 'upload_failed' };
  const same = sha256(new Uint8Array(await stored.data.arrayBuffer())) === sha256(bytes);
  return same ? { ok: true, existed: true } : { ok: false, code: 'exists_differs' };
}

export type AgreementFile = { number: string; bytes: Uint8Array };

/**
 * A rendered agreement's PDF, for the mail attachment. The path comes from the row (`agreement_file`), never from a
 * payload, and the bytes are checked against the stored hash. Null when it cannot be read now (the mail retries).
 */
export async function downloadAgreement(db: Db, agreementId: string): Promise<AgreementFile | null> {
  const { data: file, error } = await db.rpc('agreement_file', { p_id: agreementId });
  if (error || !file) return null;
  const row = file as { number?: unknown; storage_path?: unknown; sha256?: unknown };
  if (
    typeof row.storage_path !== 'string' ||
    typeof row.sha256 !== 'string' ||
    typeof row.number !== 'string'
  ) {
    return null;
  }
  const stored = await db.storage.from(AGREEMENTS_BUCKET).download(row.storage_path);
  if (stored.error || !stored.data) return null;
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  if (sha256(bytes) !== row.sha256) return null;
  return { number: row.number, bytes };
}
