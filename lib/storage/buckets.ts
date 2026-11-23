/**
 * The two provider buckets and every file rule the browser and the server share (spec 0006). The
 * database holds the same facts (migration `provider_onboarding`: the buckets, `provider_object_type`,
 * `register_provider_document`); tests/storage-files.test.ts proves the two agree.
 *
 * No SDK and no `server-only` here: client.ts and server.ts both read it.
 */

export const DOCUMENT_TYPES = [
  'profile_photo',
  'id_front',
  'id_back',
  'selfie',
  'criminal_record',
  'skill_certificate',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export const DOCUMENTS_BUCKET = 'provider-documents';
export const PHOTOS_BUCKET = 'provider-photos';
/** Report photos (spec 0011-14 AC-2, X-5): private, JPEG only, `<region>/<report id>/<uuid>.jpg`. */
export const REPORTS_BUCKET = 'report-photos';
/**
 * Service agreements (spec 0011-20 AC-6, AC-11): private, PDF only, 1 MiB, `<region>/<year>/<agreement id>-r<n>.pdf`.
 * Only the relay uploads (its own handle, no upsert); a party or admin reads through a signed link after an open or a view.
 */
export const AGREEMENTS_BUCKET = 'service-agreements';
export type ProviderBucket = typeof DOCUMENTS_BUCKET | typeof PHOTOS_BUCKET;
export type Bucket = ProviderBucket | typeof REPORTS_BUCKET | typeof AGREEMENTS_BUCKET;

/** The photo has its own bucket, so position 06 can open photos without any rule touching IDs. */
export function bucketFor(type: DocumentType): ProviderBucket {
  return type === 'profile_photo' ? PHOTOS_BUCKET : DOCUMENTS_BUCKET;
}

/** What Storage itself accepts per bucket, after encoding. */
export const BUCKET_LIMIT_BYTES: Readonly<Record<Bucket, number>> = {
  [DOCUMENTS_BUCKET]: 10 * 1024 * 1024,
  [PHOTOS_BUCKET]: 2 * 1024 * 1024,
  [REPORTS_BUCKET]: 10 * 1024 * 1024,
  [AGREEMENTS_BUCKET]: 1024 * 1024,
};

/** An image larger than this is refused before it is decoded (AC-7): a phone camera stays well under. */
export const RAW_IMAGE_LIMIT_BYTES = 25 * 1024 * 1024;

/** The kinds a card accepts, read from the first bytes. */
export type FileKind = 'jpeg' | 'png' | 'pdf';

export const ACCEPTS: Readonly<Record<DocumentType, readonly FileKind[]>> = {
  profile_photo: ['jpeg', 'png'],
  id_front: ['jpeg', 'png'],
  id_back: ['jpeg', 'png'],
  selfie: ['jpeg', 'png'],
  criminal_record: ['jpeg', 'png', 'pdf'],
  skill_certificate: ['jpeg', 'png', 'pdf'],
};

/** The `accept` attribute of each card's file input. HEIC is left out: iOS converts it to JPEG on pick. */
export function acceptAttribute(type: DocumentType): string {
  const parts = ACCEPTS[type].flatMap((kind) =>
    kind === 'jpeg'
      ? ['image/jpeg', '.jpg', '.jpeg']
      : kind === 'png'
        ? ['image/png', '.png']
        : ['application/pdf', '.pdf'],
  );
  return parts.join(',');
}

/** Images are re-encoded as JPEG (EXIF rotation applied, EXIF location dropped), PDFs pass as they are. */
export const MAX_SIDE_PX: Readonly<Record<'photo' | 'document', number>> = { photo: 1024, document: 2400 };
export const JPEG_QUALITY = 0.85;

/** Admin's link to a document (AC-16). Never logged, never in a URL of ours, never sent to telemetry. */
export const SIGNED_LINK_SECONDS = 60;
/** Spec 0011-20 AC-9: a party's agreement link (a phone download over a slow line); admin's stays 60 seconds. */
export const AGREEMENT_LINK_SECONDS = 300;
/** The provider's own photo in a server render (Value sourcing: 300 seconds). */
export const PHOTO_LINK_SECONDS = 300;

/** The stored extension and content type of an upload of this kind. */
export function storedAs(kind: FileKind): {
  ext: 'jpg' | 'pdf';
  contentType: 'image/jpeg' | 'application/pdf';
} {
  return kind === 'pdf'
    ? { ext: 'pdf', contentType: 'application/pdf' }
    : { ext: 'jpg', contentType: 'image/jpeg' };
}

/** `{userId}/{type}/{uuid}.{ext}`, the one shape `provider_may_store` allows. Lower case uuids only. */
export function objectPath(userId: string, type: DocumentType, id: string, ext: 'jpg' | 'pdf'): string {
  return `${userId.toLowerCase()}/${type}/${id.toLowerCase()}.${ext}`;
}

/** `<region>/<year>/<agreement id>-r<attempt>.pdf`, the one shape the bucket's guard admits (spec 0011-20 AC-6). */
export function agreementPath(region: string, year: string, agreementId: string, attempt: number): string {
  return `${region}/${year}/${agreementId.toLowerCase()}-r${attempt}.pdf`;
}

/** Spec 0011-14 AC-2: at most three photos per report; the database caps it again (`add_report_photo`). */
export const REPORT_PHOTO_MAX = 3;
/** A report photo's longest side after the re-encode: enough to read a receipt or a crack in a tile. */
export const REPORT_PHOTO_MAX_SIDE_PX = 2048;

/** `<region>/<report id>/<uuid>.jpg`, the one shape `report_photo_allowed` admits (X-5). Lower case uuids only. */
export function reportPhotoPath(region: string, reportId: string, id: string): string {
  return `${region}/${reportId.toLowerCase()}/${id.toLowerCase()}.jpg`;
}
