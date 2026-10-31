import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0005 AC-12. The user comes from `getUser()`, the role from `app_metadata`. A refusal in a Server
 * Action is a return value; a page goes to login, onboarding or the user's own home.
 */

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
  redirect: vi.fn((target: unknown) => {
    throw new Error(`redirect:${JSON.stringify(target)}`);
  }),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: auth.getUser, signOut: auth.signOut, refreshSession: auth.refreshSession },
  }),
}));
vi.mock('@/lib/i18n/navigation', () => ({ redirect: auth.redirect }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'tr' }));

import {
  AuthRefusal,
  getSessionUser,
  guardPage,
  requireRole,
  requireUser,
  signOutHere,
} from '@/lib/auth/session';

function asUser(appMetadata: Record<string, unknown> | null) {
  auth.getUser.mockResolvedValue(
    appMetadata === null
      ? { data: { user: null }, error: new Error('no session') }
      : { data: { user: { id: 'u1', app_metadata: appMetadata } }, error: null },
  );
}

beforeEach(() => {
  auth.getUser.mockReset();
  auth.redirect.mockClear();
});

describe('getSessionUser', () => {
  it('reads the role and the region from app_metadata', async () => {
    asUser({ role: 'provider', region: 'TR' });
    expect(await getSessionUser()).toEqual({ id: 'u1', role: 'provider', region: 'TR' });
  });

  it('has no role before onboarding', async () => {
    asUser({ provider: 'phone' });
    expect(await getSessionUser()).toEqual({ id: 'u1', role: null, region: null });
  });

  it('refuses an unknown role and a region it does not know', async () => {
    asUser({ role: 'superuser', region: 'XX' });
    expect(await getSessionUser()).toEqual({ id: 'u1', role: null, region: null });
  });

  it('is null with no session', async () => {
    asUser(null);
    expect(await getSessionUser()).toBeNull();
  });
});

describe('requireUser and requireRole', () => {
  it('refuses no session as unauthorized', async () => {
    asUser(null);
    await expect(requireUser()).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(requireRole()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('refuses no role and the wrong role as forbidden', async () => {
    asUser({ provider: 'phone' });
    await expect(requireRole()).rejects.toBeInstanceOf(AuthRefusal);
    await expect(requireRole()).rejects.toMatchObject({ code: 'forbidden' });
    asUser({ role: 'customer', region: 'TR' });
    await expect(requireRole('admin')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('passes the right role, or any role when none is named', async () => {
    asUser({ role: 'customer', region: 'TR' });
    await expect(requireRole('customer', 'admin')).resolves.toMatchObject({ role: 'customer' });
    await expect(requireRole()).resolves.toMatchObject({ role: 'customer' });
  });

  it('asks the Auth server on every call in an action, never trusting an earlier answer', async () => {
    asUser({ role: 'customer', region: 'TR' });
    await requireRole();
    await requireRole();
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });
});

describe('guardPage', () => {
  it('sends no session to login', async () => {
    asUser(null);
    await expect(guardPage('any')).rejects.toThrow(/redirect/);
    expect(auth.redirect).toHaveBeenCalledWith({ href: '/login', locale: 'tr' });
  });

  it('sends no role to onboarding', async () => {
    asUser({ provider: 'phone' });
    await expect(guardPage('any')).rejects.toThrow(/redirect/);
    expect(auth.redirect).toHaveBeenCalledWith({ href: '/onboarding', locale: 'tr' });
  });

  it('sends the wrong role to their own home', async () => {
    asUser({ role: 'customer', region: 'TR' });
    await expect(guardPage(['admin'])).rejects.toThrow(/redirect/);
    expect(auth.redirect).toHaveBeenCalledWith({ href: '/requests', locale: 'tr' });
  });

  it('returns the user for the right role', async () => {
    asUser({ role: 'provider', region: 'TR' });
    await expect(guardPage(['provider'])).resolves.toMatchObject({ id: 'u1', role: 'provider' });
    expect(auth.redirect).not.toHaveBeenCalled();
  });
});

describe('signOutHere', () => {
  it('ends this device only: the library default ends every device (AC-19)', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await signOutHere();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
