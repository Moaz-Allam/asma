import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ACCEPTS,
  acceptAttribute,
  BUCKET_LIMIT_BYTES,
  bucketFor,
  DOCUMENT_TYPES,
  DOCUMENTS_BUCKET,
  objectPath,
  PHOTOS_BUCKET,
  SIGNED_LINK_SECONDS,
  storedAs,
} from '@/lib/storage/buckets';
import { sniff, uploadErrorCode } from '@/lib/storage/files';

/**
 * Spec 0006 AC-7, AC-22, AC-24: the browser's file checks, the Storage error map (from real local
 * responses), and the file rules the browser shares with the database, proven equal to the migration.
 */

const MIGRATION = readFileSync('supabase/migrations/20261110090000_provider_onboarding.sql', 'utf8');
const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniff: the first bytes say what a file is', () => {
  it('reads JPEG, PNG and PDF', () => {
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe('png');
    expect(sniff(text('%PDF-1.7'))).toBe('pdf');
  });

  it('refuses everything else, a renamed text file and an executable among them', () => {
    expect(sniff(text('This is plain text'))).toBeNull();
    expect(sniff(text('MZ\x90\x00'))).toBeNull();
    expect(sniff(text('%PDF'))).toBeNull();
    expect(sniff(bytes())).toBeNull();
    expect(sniff(bytes(0xff, 0xd8))).toBeNull();
    // GIF and HEIC are not accepted anywhere.
    expect(sniff(text('GIF89a'))).toBeNull();
    expect(sniff(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70))).toBeNull();
  });
});

describe('uploadErrorCode: real Storage responses (400 with the status in the body)', () => {
  it('maps size, type and policy refusals', () => {
    expect(uploadErrorCode({ status: 400, statusCode: '413', code: 'EntityTooLarge' })).toBe(
      'file_too_large',
    );
    expect(uploadErrorCode({ status: 400, statusCode: '415', code: 'InvalidMimeType' })).toBe(
      'file_type_refused',
    );
    expect(uploadErrorCode({ status: 400, statusCode: '403', code: 'AccessDenied' })).toBe('upload_refused');
    expect(uploadErrorCode({ status: 400, statusCode: '409', code: 'KeyAlreadyExists' })).toBe(
      'upload_refused',
    );
  });

  it('calls a fetch failure the network, and an unknown shape a refusal', () => {
    expect(uploadErrorCode({ name: 'StorageUnknownError' })).toBe('network');
    expect(uploadErrorCode(new TypeError('Failed to fetch'))).toBe('network');
    expect(uploadErrorCode(null)).toBe('upload_refused');
    expect(uploadErrorCode('x')).toBe('upload_refused');
  });
});

describe('bucket rules equal the migration', () => {
  it('the photo has its own bucket; every other type sits in the documents bucket', () => {
    expect(bucketFor('profile_photo')).toBe(PHOTOS_BUCKET);
    for (const type of DOCUMENT_TYPES.filter((t) => t !== 'profile_photo'))
      expect(bucketFor(type)).toBe(DOCUMENTS_BUCKET);
  });

  it('the limits equal the buckets the migration creates', () => {
    expect(MIGRATION).toContain(
      `('provider-documents', 'provider-documents', false, ${BUCKET_LIMIT_BYTES[DOCUMENTS_BUCKET]},`,
    );
    expect(MIGRATION).toContain(
      `('provider-photos', 'provider-photos', false, ${BUCKET_LIMIT_BYTES[PHOTOS_BUCKET]},`,
    );
  });

  it('every document type is the migration check', () => {
    expect(MIGRATION).toContain(`type in (${DOCUMENT_TYPES.map((t) => `'${t}'`).join(', ')})`);
  });

  it('PDF is accepted only where the database allows a .pdf name', () => {
    const pdfTypes = DOCUMENT_TYPES.filter((t) => ACCEPTS[t].includes('pdf'));
    expect(pdfTypes).toEqual(['criminal_record', 'skill_certificate']);
    expect(MIGRATION).toContain("'/(criminal_record|skill_certificate)/' || u.id || '\\.(jpg|png|pdf)$'");
  });

  it('every image is stored as JPEG, so a .jpg name, and a PDF as .pdf', () => {
    expect(storedAs('png')).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
    expect(storedAs('jpeg')).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
    expect(storedAs('pdf')).toEqual({ ext: 'pdf', contentType: 'application/pdf' });
  });

  it('builds the one path shape the insert policy allows, lower case', () => {
    expect(
      objectPath(
        '6F1C2D3E-0000-4000-8000-000000000001',
        'selfie',
        'A0000000-0000-4000-8000-000000000002',
        'jpg',
      ),
    ).toBe('6f1c2d3e-0000-4000-8000-000000000001/selfie/a0000000-0000-4000-8000-000000000002.jpg');
  });

  it('lists HEIC nowhere in an accept attribute', () => {
    for (const type of DOCUMENT_TYPES) expect(acceptAttribute(type)).not.toMatch(/heic/i);
    expect(acceptAttribute('id_front')).toBe('image/jpeg,.jpg,.jpeg,image/png,.png');
  });

  it('signs admin links for 60 seconds', () => {
    expect(SIGNED_LINK_SECONDS).toBe(60);
  });
});
