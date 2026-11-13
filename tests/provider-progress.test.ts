import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

import { progressPercent, progressRows } from '@/components/features/provider/FileProgress';
import type { ProviderDocument, ProviderFile } from '@/lib/provider/queries';
import type { DocumentType } from '@/lib/storage/buckets';

/**
 * Spec 0006 Value sourcing, `FileProgress`: rows are phone (always done), profile (profile row and photo),
 * ID (both sides), selfie, and the criminal record when required. A row is done when its rows exist and
 * none is rejected; the percent is floor(done / total * 100).
 */

function doc(type: DocumentType, status: ProviderDocument['status'] = 'pending'): ProviderDocument {
  return {
    id: type,
    type,
    objectId: type,
    path: type,
    mimeType: 'image/jpeg',
    status,
    rejectionCode: status === 'rejected' ? 'document_unclear' : null,
    rejectionNote: null,
    validUntil: null,
    uploadedAt: '2026-11-10T00:00:00Z',
  };
}

function file(docs: ProviderDocument[], options: { profile?: boolean; record?: boolean } = {}): ProviderFile {
  return {
    id: 'p',
    region: 'TR',
    status: 'draft',
    entityType: options.profile === false ? null : 'individual',
    legalName: null,
    taxNumber: null,
    reviewReason: null,
    rejectionCode: null,
    rejectionNote: null,
    suspensionReason: null,
    submittedAt: null,
    decidedAt: null,
    approvedAt: null,
    approvedName: null,
    updatedAt: '2026-11-10T00:00:00Z',
    profile: options.profile === false ? null : { bio: 'x'.repeat(40), years: 3, languages: ['tr'] },
    documents: Object.fromEntries(docs.map((d) => [d.type, d])),
    requiredTypes:
      options.record === false
        ? ['profile_photo', 'id_front', 'id_back', 'selfie']
        : ['profile_photo', 'id_front', 'id_back', 'selfie', 'criminal_record'],
  };
}

describe('FileProgress rows', () => {
  it('a new provider has only the phone done: 1 of 5 is 20%', () => {
    const rows = progressRows(file([], { profile: false }));
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ['phone', 'done'],
      ['profile', 'missing'],
      ['id', 'missing'],
      ['selfie', 'missing'],
      ['criminal_record', 'missing'],
    ]);
    expect(progressPercent(rows)).toBe(20);
  });

  it('the profile row needs both the saved profile and the photo', () => {
    expect(progressRows(file([doc('profile_photo')], { profile: false }))[1]?.state).toBe('missing');
    expect(progressRows(file([], { profile: true }))[1]?.state).toBe('missing');
    expect(progressRows(file([doc('profile_photo')]))[1]?.state).toBe('done');
  });

  it('the ID needs both sides, and a rejected side marks it rejected', () => {
    expect(progressRows(file([doc('id_front')]))[2]?.state).toBe('missing');
    expect(progressRows(file([doc('id_front'), doc('id_back')]))[2]?.state).toBe('done');
    expect(progressRows(file([doc('id_front'), doc('id_back', 'rejected')]))[2]?.state).toBe('rejected');
  });

  it('drops the record row when the region does not require it, and floors the percent', () => {
    const rows = progressRows(file([doc('profile_photo')], { record: false }));
    expect(rows.map((r) => r.key)).toEqual(['phone', 'profile', 'id', 'selfie']);
    expect(progressPercent(rows)).toBe(50);
    const three = progressRows(file([doc('profile_photo'), doc('selfie')]));
    expect(progressPercent(three)).toBe(60);
    const two = progressRows(file([doc('selfie')], { profile: false, record: true }));
    expect(progressPercent(two)).toBe(40);
  });
});
