import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/** Spec 0005 AC-12: auth first, then Zod, then the handler; a stable code, never a throw. */

const session = vi.hoisted(() => ({ requireUser: vi.fn(), requireRole: vi.fn(), report: vi.fn() }));

vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireUser: session.requireUser,
  requireRole: session.requireRole,
}));
vi.mock('@/lib/observability/server', () => ({ reportServerError: session.report }));
vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn() }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn() }));
vi.mock('@/lib/i18n/navigation', () => ({ redirect: vi.fn() }));

import { fail, guardedAction } from '@/lib/auth/action';
import { AuthRefusal } from '@/lib/auth/session';

const USER = { id: 'u1', role: 'customer' as const, region: 'TR' as const };
const Schema = z.object({ name: z.string() });

beforeEach(() => {
  session.requireUser.mockReset().mockResolvedValue(USER);
  session.requireRole.mockReset().mockResolvedValue(USER);
  session.report.mockClear();
});

describe('guardedAction', () => {
  it('passes the parsed input and the checked user to the handler', async () => {
    const handler = vi.fn(async () => ({ done: true }));
    const action = guardedAction({ name: 'x', access: 'any_role', schema: Schema }, handler);
    await expect(action({ name: 'a', extra: 1 })).resolves.toEqual({ success: true, data: { done: true } });
    expect(handler).toHaveBeenCalledWith({ name: 'a' }, USER);
  });

  it('checks once', async () => {
    const action = guardedAction({ name: 'x', access: 'signed_in', schema: Schema }, async () => 1);
    await action({ name: 'a' });
    expect(session.requireUser).toHaveBeenCalledTimes(1);
  });

  it('asks for the named roles', async () => {
    const action = guardedAction({ name: 'x', access: ['admin'], schema: Schema }, async () => 1);
    await action({ name: 'a' });
    expect(session.requireRole).toHaveBeenCalledWith('admin');
  });

  it('checks auth before validation, so bad input from anyone anonymous learns nothing', async () => {
    session.requireRole.mockRejectedValue(new AuthRefusal('unauthorized'));
    const handler = vi.fn(async () => 1);
    const action = guardedAction({ name: 'x', access: 'any_role', schema: Schema }, handler);
    await expect(action('nonsense')).resolves.toEqual({ success: false, error: 'unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns forbidden for the wrong role', async () => {
    session.requireRole.mockRejectedValue(new AuthRefusal('forbidden'));
    const action = guardedAction({ name: 'x', access: ['admin'], schema: Schema }, async () => 1);
    await expect(action({ name: 'a' })).resolves.toEqual({ success: false, error: 'forbidden' });
  });

  it('refuses bad input with a stable code', async () => {
    const handler = vi.fn(async () => 1);
    const action = guardedAction({ name: 'x', access: 'any_role', schema: Schema }, handler);
    await expect(action({ name: 1 })).resolves.toEqual({ success: false, error: 'validation_failed' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets a handler answer with a code', async () => {
    const action = guardedAction({ name: 'x', access: 'any_role', schema: Schema }, async () =>
      fail('phone_taken'),
    );
    await expect(action({ name: 'a' })).resolves.toEqual({ success: false, error: 'phone_taken' });
  });

  it('never throws: an unexpected error is reported and becomes a code', async () => {
    const boom = new Error('secret detail');
    const action = guardedAction({ name: 'thing', access: 'any_role', schema: Schema }, async () => {
      throw boom;
    });
    await expect(action({ name: 'a' })).resolves.toEqual({ success: false, error: 'action_failed' });
    expect(session.report).toHaveBeenCalledWith('thing', boom);
  });
});
