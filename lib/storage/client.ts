'use client';

import { createSupabaseBrowser } from '@/lib/db/client';

import {
  ACCEPTS,
  BUCKET_LIMIT_BYTES,
  bucketFor,
  JPEG_QUALITY,
  MAX_SIDE_PX,
  objectPath,
  RAW_IMAGE_LIMIT_BYTES,
  REPORT_PHOTO_MAX_SIDE_PX,
  reportPhotoPath,
  REPORTS_BUCKET,
  storedAs,
  type DocumentType,
} from './buckets';
import { sniff, uploadErrorCode, type UploadCode } from './files';

/**
 * Browser to Storage, straight (spec 0006 AC-4, AC-7, D116). The order: read the first bytes and refuse
 * a file the card does not accept, before any upload; decode an image with its EXIF rotation, downscale
 * it and encode it as JPEG (which drops EXIF location); pass a PDF as it is; then upload with upsert off,
 * an explicit content type (Android can report an empty type for a PDF) and `cacheControl: '0'`, so a
 * browser revalidates instead of reusing a copy of an ID (AC-25). The caller then registers the path
 * through a Server Action, which asks the database.
 */

export type UploadResult = { ok: true; path: string } | { ok: false; code: UploadCode };

async function firstBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 8).arrayBuffer());
}

/** EXIF rotation applied (`from-image`), longest side at most `maxSide`, re-encoded as JPEG. */
async function reencode(file: Blob, maxSide: number): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    // A PNG with transparency gets a white page, not a black one.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  } finally {
    bitmap.close();
  }
}

/** Checks, prepares and uploads one file. Never throws: every failure is one stable code. */
export async function uploadProviderFile(
  userId: string,
  type: DocumentType,
  file: File,
): Promise<UploadResult> {
  try {
    const kind = sniff(await firstBytes(file));
    if (kind === null || !ACCEPTS[type].includes(kind)) return { ok: false, code: 'file_type_refused' };

    // storage-js sends a Blob as a form part carrying the Blob's own type and ignores `contentType` there,
    // so a PDF picked with an empty type (Android) would be refused as `invalid_mime_type`: rewrap it.
    let body: Blob = new Blob([file], { type: storedAs(kind).contentType });
    if (kind !== 'pdf') {
      if (file.size > RAW_IMAGE_LIMIT_BYTES) return { ok: false, code: 'file_too_large' };
      const encoded = await reencode(
        file,
        type === 'profile_photo' ? MAX_SIDE_PX.photo : MAX_SIDE_PX.document,
      );
      if (!encoded) return { ok: false, code: 'image_unreadable' };
      body = encoded;
    }

    const bucket = bucketFor(type);
    if (body.size > BUCKET_LIMIT_BYTES[bucket]) return { ok: false, code: 'file_too_large' };

    const { ext, contentType } = storedAs(kind);
    const path = objectPath(userId, type, crypto.randomUUID(), ext);
    const { error } = await createSupabaseBrowser()
      .storage.from(bucket)
      .upload(path, body, { upsert: false, contentType, cacheControl: '0' });
    if (error) return { ok: false, code: uploadErrorCode(error) };
    return { ok: true, path };
  } catch (error) {
    return { ok: false, code: uploadErrorCode(error) };
  }
}

/**
 * One report photo (spec 0011-14 AC-2, X-5, X-25): a JPEG or PNG by its first bytes, decoded with its EXIF
 * rotation, downscaled and re-encoded as JPEG (which drops EXIF, location included), then uploaded with upsert
 * off under the open report's own folder. The caller registers the path through a Server Action
 * (`add_report_photo`), which reads the size and type Storage recorded. Never throws.
 */
export async function uploadReportPhoto(region: string, reportId: string, file: File): Promise<UploadResult> {
  try {
    const kind = sniff(await firstBytes(file));
    if (kind !== 'jpeg' && kind !== 'png') return { ok: false, code: 'file_type_refused' };
    if (file.size > RAW_IMAGE_LIMIT_BYTES) return { ok: false, code: 'file_too_large' };
    const body = await reencode(file, REPORT_PHOTO_MAX_SIDE_PX);
    if (!body) return { ok: false, code: 'image_unreadable' };
    if (body.size > BUCKET_LIMIT_BYTES[REPORTS_BUCKET]) return { ok: false, code: 'file_too_large' };
    const path = reportPhotoPath(region, reportId, crypto.randomUUID());
    const { error } = await createSupabaseBrowser()
      .storage.from(REPORTS_BUCKET)
      .upload(path, body, { upsert: false, contentType: 'image/jpeg', cacheControl: '0' });
    if (error) return { ok: false, code: uploadErrorCode(error) };
    return { ok: true, path };
  } catch (error) {
    return { ok: false, code: uploadErrorCode(error) };
  }
}

/** The local preview of a file just picked, until the page reloads (AC-4). The caller revokes it. */
export function localPreview(file: Blob): string {
  return URL.createObjectURL(file);
}
