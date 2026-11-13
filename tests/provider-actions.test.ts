import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0006, the action layer of position 02: what the Server Actions do around the database functions.
 * The functions themselves are proven in pgTAP (07); here the database calls are stubs, so each branch of
 * the action can be driven on purpose: the sweep after a register and its failure event (AC-8), no link
 * when the view audit fails (AC-16), the submit outcome (AC-9), the decision replay (AC-18), and the code
 * mapping that keeps a known refusal out of Sentry.
 */

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  report: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  registerDocumentInDb: vi.fn(),
  submitFileInDb: vi.fn(),
  logDocumentViewInDb: vi.fn(),
  decideProviderInDb: vi.fn(),
  signedLink: vi.fn(),
  removeOld: vi.fn(),
}));

vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: m.warn, error: m.error, info: vi.fn() } }));
vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'tr') }));
vi.mock('@/lib/i18n/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/provider/db', () => ({
  registerDocumentInDb: m.registerDocumentInDb,
  submitFileInDb: m.submitFileInDb,
  logDocumentViewInDb: m.logDocumentViewInDb,
  decideProviderInDb: m.decideProviderInDb,
  saveProfileInDb: vi.fn(),
  acceptDocsConsentInDb: vi.fn(),
  reviewDocumentsInDb: vi.fn(),
  suspendProviderInDb: vi.fn(),
  reinstateProviderInDb: vi.fn(),
}));
vi.mock('@/lib/storage/server', () => ({ signedLink: m.signedLink, removeOld: m.removeOld }));

import { decideProvider, showDocument } from '@/actions/admin-providers';
import { registerDocument, submitProviderFile } from '@/actions/provider';
import { ADMIN_DB_CODES, databaseCode, PROVIDER_DB_CODES } from '@/lib/provider/codes';
import { SIGNED_LINK_SECONDS } from '@/lib/storage/buckets';

const PROVIDER = {
  id: '00000000-0000-4000-8000-0000000000a1',
  role: 'provider' as const,
  region: 'TR' as const,
};
const ADMIN = { id: '00000000-0000-4000-8000-0000000000d1', role: 'admin' as const, region: 'TR' as const };
const DOC = '00000000-0000-4000-8000-000000000001';
const OBJ = '00000000-0000-4000-8000-000000000002';
const PATH = `${PROVIDER.id}/selfie/00000000-0000-4000-8000-000000000003.jpg`;

/** What PostgREST hands back when a function raises `exception 'code'`. */
const raised = (message: string) => Object.assign(new Error(message), { code: 'P0001' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerDocument (AC-8)', () => {
  beforeEach(() => m.requireRole.mockResolvedValue(PROVIDER));

  const row = (extra: Partial<Record<string, unknown>> = {}) => ({
    id: DOC,
    type: 'selfie',
    status: 'pending',
    object_id: OBJ,
    previous_path: null,
    sweep: [],
    backToReview: false,
    created: true,
    ...extra,
  });

  it('deletes the previous file and every swept orphan, and logs nothing when all went', async () => {
    m.registerDocumentInDb.mockResolvedValue(row({ previous_path: 'old.jpg', sweep: ['orphan.jpg'] }));
    m.removeOld.mockResolvedValue({ failed: [] });
    await expect(registerDocument({ type: 'selfie', path: PATH })).resolves.toEqual({
      success: true,
      data: { id: DOC, status: 'pending', backToReview: false },
    });
    expect(m.removeOld).toHaveBeenCalledWith('provider-documents', ['old.jpg', 'orphan.jpg']);
    expect(m.warn).not.toHaveBeenCalled();
  });

  it('logs document_sweep_failed with ids only when a delete did not happen, and still succeeds', async () => {
    m.registerDocumentInDb.mockResolvedValue(row({ previous_path: 'old.jpg', backToReview: true }));
    m.removeOld.mockResolvedValue({ failed: ['old.jpg'] });
    const result = await registerDocument({ type: 'selfie', path: PATH });
    expect(result).toEqual({ success: true, data: { id: DOC, status: 'pending', backToReview: true } });
    expect(m.warn).toHaveBeenCalledWith('document_sweep_failed', { user_id: PROVIDER.id, region: 'TR' });
    expect(JSON.stringify(m.warn.mock.calls)).not.toContain('old.jpg');
  });

  it('calls no delete when there is nothing to sweep', async () => {
    m.registerDocumentInDb.mockResolvedValue(row());
    await registerDocument({ type: 'profile_photo', path: PATH });
    expect(m.removeOld).not.toHaveBeenCalled();
  });

  it('maps a known refusal to its code, with no Sentry report', async () => {
    m.registerDocumentInDb.mockRejectedValue(raised('file_missing'));
    await expect(registerDocument({ type: 'selfie', path: PATH })).resolves.toEqual({
      success: false,
      error: 'file_missing',
    });
    expect(m.report).not.toHaveBeenCalled();
  });

  it('reports anything else and answers action_failed', async () => {
    m.registerDocumentInDb.mockRejectedValue(raised('something new'));
    await expect(registerDocument({ type: 'selfie', path: PATH })).resolves.toEqual({
      success: false,
      error: 'action_failed',
    });
    expect(m.report).toHaveBeenCalledTimes(1);
  });
});

describe('submitProviderFile (AC-9)', () => {
  beforeEach(() => m.requireRole.mockResolvedValue(PROVIDER));

  it('leads with file_missing, and still names every card that needs work', async () => {
    m.submitFileInDb.mockResolvedValue({
      status: 'draft',
      missing: ['criminal_record'],
      rejected: ['selfie'],
      objectsMissing: ['id_front'],
    });
    await expect(submitProviderFile()).resolves.toEqual({
      success: true,
      data: {
        status: 'draft',
        incomplete: { code: 'file_missing', types: ['id_front', 'criminal_record', 'selfie'] },
      },
    });
  });

  it('answers file_incomplete for missing and rejected types', async () => {
    m.submitFileInDb.mockResolvedValue({
      status: 'rejected',
      missing: ['consent'],
      rejected: ['selfie'],
      objectsMissing: [],
    });
    const result = await submitProviderFile();
    expect(result).toEqual({
      success: true,
      data: { status: 'rejected', incomplete: { code: 'file_incomplete', types: ['consent', 'selfie'] } },
    });
  });

  it('answers pending with nothing incomplete when the file went', async () => {
    m.submitFileInDb.mockResolvedValue({ status: 'pending', missing: [], rejected: [], objectsMissing: [] });
    await expect(submitProviderFile()).resolves.toEqual({
      success: true,
      data: { status: 'pending', incomplete: null },
    });
  });
});

describe('showDocument (AC-16)', () => {
  beforeEach(() => m.requireRole.mockResolvedValue(ADMIN));

  it('signs no link when the view audit fails, and logs document_view_audit_failed', async () => {
    m.logDocumentViewInDb.mockRejectedValue(raised('connection reset'));
    await expect(showDocument({ documentId: DOC, objectId: OBJ })).resolves.toEqual({
      success: false,
      error: 'action_failed',
    });
    expect(m.signedLink).not.toHaveBeenCalled();
    expect(m.error).toHaveBeenCalledWith('document_view_audit_failed', { user_id: ADMIN.id });
  });

  it('answers a stale file with its code and signs nothing', async () => {
    m.logDocumentViewInDb.mockRejectedValue(raised('stale_document'));
    await expect(showDocument({ documentId: DOC, objectId: OBJ })).resolves.toEqual({
      success: false,
      error: 'stale_document',
    });
    expect(m.signedLink).not.toHaveBeenCalled();
  });

  it('signs a link for SIGNED_LINK_SECONDS only after the view row, and says what kind of file it is', async () => {
    m.logDocumentViewInDb.mockResolvedValue({
      bucket: 'provider-documents',
      path: PATH,
      mime_type: 'application/pdf',
    });
    m.signedLink.mockResolvedValue('https://storage.example/signed');
    await expect(showDocument({ documentId: DOC, objectId: OBJ })).resolves.toEqual({
      success: true,
      data: { url: 'https://storage.example/signed', kind: 'pdf' },
    });
    expect(m.signedLink).toHaveBeenCalledWith('provider-documents', PATH, SIGNED_LINK_SECONDS);
    expect(m.logDocumentViewInDb.mock.invocationCallOrder[0]).toBeLessThan(
      m.signedLink.mock.invocationCallOrder[0]!,
    );
  });

  it('answers file_missing when Storage gives no link', async () => {
    m.logDocumentViewInDb.mockResolvedValue({
      bucket: 'provider-documents',
      path: PATH,
      mime_type: 'image/jpeg',
    });
    m.signedLink.mockResolvedValue(null);
    await expect(showDocument({ documentId: DOC, objectId: OBJ })).resolves.toEqual({
      success: false,
      error: 'file_missing',
    });
  });
});

describe('decideProvider (AC-18)', () => {
  it('passes the replay flag through, so the browser fires the decision event once', async () => {
    m.requireRole.mockResolvedValue(ADMIN);
    m.decideProviderInDb.mockResolvedValue({ status: 'approved', replayed: true });
    await expect(
      decideProvider({
        providerId: PROVIDER.id,
        decision: 'approved',
        seenUpdatedAt: '2026-11-11T10:00:00Z',
        code: null,
        note: null,
      }),
    ).resolves.toEqual({ success: true, data: { status: 'approved', replayed: true } });
  });
});

describe('databaseCode', () => {
  it('reads a known code from a PostgREST error', () => {
    expect(databaseCode(raised('provider_suspended'), PROVIDER_DB_CODES)).toBe('provider_suspended');
    expect(databaseCode({ message: 'stale_profile' }, ADMIN_DB_CODES)).toBe('stale_profile');
  });

  it('answers null for anything it does not know, so the guard reports it', () => {
    expect(databaseCode(raised('stale_profile'), PROVIDER_DB_CODES)).toBeNull();
    expect(databaseCode(new Error('duplicate key value'), ADMIN_DB_CODES)).toBeNull();
    expect(databaseCode('forbidden', ADMIN_DB_CODES)).toBeNull();
    expect(databaseCode(null, ADMIN_DB_CODES)).toBeNull();
  });
});
