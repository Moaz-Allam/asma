import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseQueueQuery, queueSearch } from '@/lib/provider/admin-queries';
import {
  bioLength,
  LIMITS,
  normaliseTaxNumber,
  PROVIDER_LANGUAGES,
  REJECT_CHIPS,
  REJECTION_CODES,
  REVIEW_REASONS,
  STANDINGS,
} from '@/lib/provider/options';
import { DOCUMENT_TYPES } from '@/lib/storage/buckets';

/**
 * Spec 0006 Value sourcing: the lists the app shows equal the checks in the database, and the small
 * helpers count and fold exactly as the database does.
 */

const MIGRATION = readFileSync('supabase/migrations/20261110090000_provider_onboarding.sql', 'utf8');
const quoted = (list: readonly string[]) => list.map((v) => `'${v}'`).join(', ');

describe('the lists equal the migration', () => {
  it('PROVIDER_LANGUAGES is the languages check (owner, 2026-11-01)', () => {
    expect(MIGRATION).toContain(`languages <@ array[${quoted(PROVIDER_LANGUAGES)}]::text[]`);
  });

  it('the six rejection codes are the check on both tables', () => {
    const inline = REJECTION_CODES.map((c) => `'${c}'`);
    for (const code of inline) expect(MIGRATION).toContain(code);
    expect(REJECTION_CODES).toHaveLength(6);
  });

  it('the review reasons are the check', () => {
    expect(MIGRATION).toContain(`review_reason in (${quoted(REVIEW_REASONS)})`);
  });

  it('the standings are the five statuses plus document_expired', () => {
    expect(MIGRATION).toContain(`status in (${quoted(STANDINGS.filter((s) => s !== 'document_expired'))})`);
  });

  it('every type has reject chips, and document_unclear is offered on every type', () => {
    for (const type of DOCUMENT_TYPES) expect(REJECT_CHIPS[type]).toContain('document_unclear');
    expect(REJECT_CHIPS.selfie).toContain('selfie_mismatch');
    expect(REJECT_CHIPS.profile_photo).toEqual(['document_unclear', 'photo_not_suitable']);
    expect(REJECT_CHIPS.criminal_record).toContain('criminal_record_invalid');
  });

  it('the bio limits are the check', () => {
    expect(MIGRATION).toContain(`char_length(btrim(bio)) between ${LIMITS.bioMin} and ${LIMITS.bioMax}`);
  });
});

describe('bioLength counts code points after trim, as the database does', () => {
  it('counts an emoji as one, and ignores the edges', () => {
    expect(bioLength('  abc  ')).toBe(3);
    expect(bioLength('ev 🧹')).toBe(4);
    expect('ev 🧹'.length).toBe(5);
    expect(bioLength('خبرة')).toBe(4);
  });

  it('trims spaces only, as btrim does: a newline at the edge stays and counts', () => {
    expect(bioLength('\nabc\n')).toBe(5);
    expect(bioLength('\tabc ')).toBe(4);
  });
});

describe('normaliseTaxNumber folds as the database does', () => {
  it('folds Arabic Indic and Persian digits and strips spaces and dashes', () => {
    expect(normaliseTaxNumber(' ١٢٣ ٤٥٦-٧٨٩٠ ')).toBe('1234567890');
    expect(normaliseTaxNumber('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    expect(normaliseTaxNumber('123 456 78 90')).toBe('1234567890');
  });
});

describe('parseQueueQuery: an invalid tab, sort or page falls back silently (AC-14)', () => {
  it('keeps a valid query', () => {
    expect(parseQueueQuery({ tab: 'approved', sort: 'newest', page: '2' })).toEqual({
      tab: 'approved',
      sort: 'newest',
      page: 2,
    });
  });

  it('falls back to pending, oldest, page 1', () => {
    expect(parseQueueQuery({ tab: 'x', page: '-1' })).toEqual({ tab: 'pending', sort: 'oldest', page: 1 });
    expect(parseQueueQuery({ tab: 'draft', sort: 'up', page: 'abc' })).toEqual({
      tab: 'pending',
      sort: 'oldest',
      page: 1,
    });
    expect(parseQueueQuery({ tab: ['rejected', 'x'], page: ['3'] })).toEqual({
      tab: 'rejected',
      sort: 'oldest',
      page: 3,
    });
    expect(parseQueueQuery({})).toEqual({ tab: 'pending', sort: 'oldest', page: 1 });
  });

  it('a draft provider is never a tab', () => {
    expect(parseQueueQuery({ tab: 'draft' }).tab).toBe('pending');
  });

  it('writes the query back for row links', () => {
    expect(queueSearch({ tab: 'pending', sort: 'oldest', page: 1 })).toBe('tab=pending&sort=oldest&page=1');
  });
});
