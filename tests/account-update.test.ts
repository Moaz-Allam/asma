import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0006 AC-12, the `/account` half: `updateAccount` reads back to review from the database after the
 * save (approved before, pending after), maps `provider_suspended` with no Sentry report, and asks for any
 * role. The trigger itself is proven in pgTAP 07.
 */

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  report: vi.fn(),
  updateProfile: vi.fn(),
  getOwnStatus: vi.fn(),
}));

vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn() }));
vi.mock('@/lib/i18n/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/account/profile', async (original) => ({
  ...(await original<typeof import('@/lib/account/profile')>()),
  updateProfile: m.updateProfile,
}));
vi.mock('@/lib/provider/queries', () => ({ getOwnStatus: m.getOwnStatus }));

import { updateAccount } from '@/actions/account';

const PROVIDER = {
  id: '00000000-0000-4000-8000-0000000000a1',
  role: 'provider' as const,
  region: 'TR' as const,
};
const CUSTOMER = {
  id: '00000000-0000-4000-8000-0000000000c1',
  role: 'customer' as const,
  region: 'TR' as const,
};
const raised = (message: string) => Object.assign(new Error(message), { code: 'P0001' });

beforeEach(() => {
  vi.clearAllMocks();
  m.updateProfile.mockResolvedValue(undefined);
});

describe('updateAccount (AC-12)', () => {
  it('asks for any role, and saves the name', async () => {
    m.requireRole.mockResolvedValue(CUSTOMER);
    await expect(updateAccount({ fullName: 'Can Müşteri' })).resolves.toEqual({
      success: true,
      data: { done: true, backToReview: false },
    });
    expect(m.requireRole).toHaveBeenCalledWith();
    expect(m.updateProfile).toHaveBeenCalledWith(CUSTOMER.id, { full_name: 'Can Müşteri' });
    expect(m.getOwnStatus).not.toHaveBeenCalled();
  });

  it('says back to review when the database moved an approved provider to pending', async () => {
    m.requireRole.mockResolvedValue(PROVIDER);
    m.getOwnStatus.mockResolvedValueOnce('approved').mockResolvedValueOnce('pending');
    await expect(updateAccount({ fullName: 'Ayşe Usta' })).resolves.toEqual({
      success: true,
      data: { done: true, backToReview: true },
    });
  });

  it('does not, when the database kept the provider approved (the same name, sent again)', async () => {
    m.requireRole.mockResolvedValue(PROVIDER);
    m.getOwnStatus.mockResolvedValue('approved');
    await expect(updateAccount({ fullName: 'Ayşe Usta' })).resolves.toEqual({
      success: true,
      data: { done: true, backToReview: false },
    });
  });

  it('does not, for a provider still in draft or under review', async () => {
    m.requireRole.mockResolvedValue(PROVIDER);
    m.getOwnStatus.mockResolvedValue('pending');
    const result = await updateAccount({ fullName: 'Ayşe Usta' });
    expect(result).toEqual({ success: true, data: { done: true, backToReview: false } });
    expect(m.getOwnStatus).toHaveBeenCalledTimes(1);
  });

  it('maps a suspended rename to provider_suspended, with no Sentry report', async () => {
    m.requireRole.mockResolvedValue(PROVIDER);
    m.getOwnStatus.mockResolvedValue('suspended');
    m.updateProfile.mockRejectedValue(raised('provider_suspended'));
    await expect(updateAccount({ fullName: 'Başka Ad' })).resolves.toEqual({
      success: false,
      error: 'provider_suspended',
    });
    expect(m.report).not.toHaveBeenCalled();
  });

  it('reports anything else and answers action_failed', async () => {
    m.requireRole.mockResolvedValue(PROVIDER);
    m.getOwnStatus.mockResolvedValue('approved');
    m.updateProfile.mockRejectedValue(raised('connection reset'));
    await expect(updateAccount({ fullName: 'Başka Ad' })).resolves.toEqual({
      success: false,
      error: 'action_failed',
    });
    expect(m.report).toHaveBeenCalledTimes(1);
  });
});
