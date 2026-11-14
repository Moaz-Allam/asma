/**
 * Pure file checks for the browser (spec 0006 AC-7): the first bytes say what a file really is, and a
 * Storage error becomes one stable code. A courtesy for honest mistakes: a hostile client skips it, and
 * the database cross checks type, extension, size and folder at register (security model).
 *
 * The codes below come from real local Storage responses (recorded in context/library-docs.md): the
 * HTTP status is 400 for every refusal, and the real one is the body's `statusCode` string.
 */

import type { FileKind } from './buckets';

/** `FF D8 FF` JPEG, `89 50 4E 47` PNG, `%PDF-` PDF. Anything else is null. */
export function sniff(bytes: Uint8Array): FileKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
    return 'pdf';
  return null;
}

export type UploadCode =
  'file_too_large' | 'file_type_refused' | 'upload_refused' | 'network' | 'image_unreadable';

type StorageErrorLike = { statusCode?: unknown; status?: unknown; code?: unknown; name?: unknown };

/** One Storage error to one code. Unknown shapes are refused, never retried as if they were the network. */
export function uploadErrorCode(error: unknown): UploadCode {
  if (typeof error !== 'object' || error === null) return 'upload_refused';
  const e = error as StorageErrorLike;
  if (e.name === 'StorageUnknownError' || e.name === 'TypeError') return 'network';
  const statusCode = String(e.statusCode ?? e.status ?? '');
  if (statusCode === '413' || e.code === 'EntityTooLarge') return 'file_too_large';
  if (statusCode === '415' || e.code === 'InvalidMimeType') return 'file_type_refused';
  return 'upload_refused';
}
