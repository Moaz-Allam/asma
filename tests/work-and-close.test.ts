import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-11, work and close: the doors (`moveJob`, `closeJob`, `loadCloseInfo`) and the actions. The rules are
 * proven in pgTAP (25, 26); here the database answers are stubs: the argument names (a request id only), the strict
 * parses, the alert on a missing confirm window, and each action's own role (AC-9).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  alert: vi.fn(),
  report: vi.fn(),
  revalidate: vi.fn(),
  role: { current: 'provider' as 'provider' | 'customer' },
}));

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })) }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => {
  const actual = await original<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    requireRole: vi.fn(async (...roles: string[]) => {
      if (roles.length > 0 && !roles.includes(m.role.current)) throw new actual.AuthRefusal('forbidden');
      return { id: '00000000-0000-4000-8000-0000000000b1', role: m.role.current, region: 'TR' };
    }),
  };
});

import { confirmJobAction, finishJobAction, markJobDoneAction, startJobAction } from '@/actions/jobs';
import { moveJob } from '@/lib/provider-feed';
import { closeJob, loadCloseInfo } from '@/lib/requests';

const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001', hint: null } });
const OK = { data: { status: 'ok', replayed: false }, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.role.current = 'provider';
});

describe('the provider moves (AC-2, AC-3)', () => {
  it('Started and Done send the request id only', async () => {
    m.rpc.mockResolvedValue(OK);
    expect(await moveJob('start', REQUEST, { region: 'TR' })).toEqual({ ok: true, replayed: false });
    expect(m.rpc).toHaveBeenCalledWith('start_job', { p_request_id: REQUEST });
    await moveJob('finish', REQUEST, { region: 'TR' });
    expect(m.rpc).toHaveBeenCalledWith('finish_job', { p_request_id: REQUEST });
  });

  it.each(['too_early', 'invalid_state', 'provider_suspended', 'not_found'])(
    'maps %s with no alert',
    async (code) => {
      m.rpc.mockResolvedValue(refuse(code));
      expect(await moveJob('start', REQUEST, { region: 'TR' })).toEqual({ ok: false, code });
      expect(m.alert).not.toHaveBeenCalled();
    },
  );

  it('alerts on a missing confirm window', async () => {
    m.rpc.mockResolvedValue(refuse('confirm_settings_invalid'));
    await moveJob('finish', REQUEST, { region: 'TR' });
    expect(m.alert).toHaveBeenCalledWith('confirm_settings_invalid', {
      recordId: 'finish_job',
      region: 'TR',
    });
  });

  it('refuses a key the function must never send', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok', replayed: false, phone: '+90' }, error: null });
    await expect(moveJob('start', REQUEST, { region: 'TR' })).rejects.toThrow();
  });
});

describe('the customer close (AC-4, AC-5, R-5)', () => {
  it('Confirm and Job done send the request id only', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok', replayed: true }, error: null });
    expect(await closeJob('confirm', REQUEST)).toEqual({ ok: true, replayed: true });
    expect(m.rpc).toHaveBeenCalledWith('confirm_job', { p_request_id: REQUEST });
    await closeJob('mark_done', REQUEST);
    expect(m.rpc).toHaveBeenCalledWith('customer_mark_done', { p_request_id: REQUEST });
  });

  it('a malformed id never reaches the database', async () => {
    expect(await closeJob('confirm', 'nope')).toEqual({ ok: false, code: 'not_found' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('reads the close info, null for anyone else', async () => {
    m.rpc.mockResolvedValue({ data: { auto_close_enabled: false, can_mark_done: true }, error: null });
    expect(await loadCloseInfo(REQUEST)).toEqual({ auto_close_enabled: false, can_mark_done: true });
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await loadCloseInfo(REQUEST)).toBeNull();
  });
});

describe('the actions take their own role (AC-9)', () => {
  it('the provider starts and finishes; the customer is forbidden there', async () => {
    m.rpc.mockResolvedValue(OK);
    expect(await startJobAction({ requestId: REQUEST })).toEqual({
      success: true,
      data: { replayed: false },
    });
    expect(await finishJobAction({ requestId: REQUEST })).toEqual({
      success: true,
      data: { replayed: false },
    });
    m.role.current = 'customer';
    expect(await startJobAction({ requestId: REQUEST })).toEqual({ success: false, error: 'forbidden' });
  });

  it('the customer confirms and closes; the provider is forbidden there', async () => {
    m.role.current = 'customer';
    m.rpc.mockResolvedValue(OK);
    expect(await confirmJobAction({ requestId: REQUEST })).toEqual({
      success: true,
      data: { replayed: false },
    });
    expect(await markJobDoneAction({ requestId: REQUEST })).toEqual({
      success: true,
      data: { replayed: false },
    });
    m.role.current = 'provider';
    expect(await confirmJobAction({ requestId: REQUEST })).toEqual({ success: false, error: 'forbidden' });
  });

  it('a refusal comes back as its code', async () => {
    m.rpc.mockResolvedValue(refuse('too_early'));
    expect(await startJobAction({ requestId: REQUEST })).toEqual({ success: false, error: 'too_early' });
  });
});
