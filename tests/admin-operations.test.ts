import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-16, admin operations: the doors, the actions, the CSV route and the pure helpers. The rules are proven in
 * pgTAP 33; here the database answers are stubs: the argument names (ids, codes and free text only, never an amount),
 * the strict parses, the refusal codes, each action's own role, and the CSV's integer formatting (R-10, X-14, rule 4).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  report: vi.fn(),
  revalidate: vi.fn(),
  role: { current: 'admin' as 'provider' | 'customer' | 'admin' | null },
}));

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })) }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => {
  const actual = await original<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    requireRole: vi.fn(async (...roles: string[]) => {
      if (m.role.current === null) throw new actual.AuthRefusal('unauthorized');
      if (roles.length > 0 && !roles.includes(m.role.current)) throw new actual.AuthRefusal('forbidden');
      return { id: '00000000-0000-4000-8000-0000000000b1', role: m.role.current, region: 'TR' };
    }),
  };
});

import {
  adminCancelRequestAction,
  adminClearFlagAction,
  adminExtendDeadlineAction,
  adminShowAddressAction,
} from '@/actions/admin-requests';
import { GET } from '@/app/api/admin/revenue/route';
import {
  cancelRequest,
  clearFlag,
  extendDeadline,
  listFlags,
  listRequests,
  showAddress,
} from '@/lib/admin-requests';
import { adminMayCancel, extendableDeadline } from '@/lib/admin-requests/constants';
import { dayFrom } from '@/lib/format/day';
import { loadRevenue, revenueCsv, revenueFileName } from '@/lib/admin-revenue';
import { formatMinorFixed } from '@/lib/money/parse';

const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const FLAG = '00000000-0000-4000-8000-0000000000c1';
const AT = '2026-11-20T09:00:00.123456+00:00';
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001', hint: null } });
const ok = (data: unknown) => ({ data, error: null });

const LIST_ROW = {
  id: REQUEST,
  region: 'TR',
  status: 'OPEN',
  service_name: { tr: 'Temizlik' },
  zone_name: { tr: 'Moda' },
  created_at: AT,
  scheduled_start_at: AT,
  fixed_price: 100000,
  currency: 'TRY',
  timezone: 'Europe/Istanbul',
  open_flags: ['start_late'],
  open_report: false,
};

const REVENUE_ROW = {
  region: 'TR',
  currency: 'TRY',
  bucket: '2026-11-20',
  commission_revenue: 10000,
  provider_fee_revenue: 5000,
  commission_refunds: 10000,
  provider_fee_refunds: 5000,
  psp_fees: 750,
  net: -750,
  late_received: 10000,
  late_refunded: 5,
};
const REPORT = { from: '2026-11-01', to: '2026-11-20', grain: 'day', rows: [REVENUE_ROW] };

beforeEach(() => {
  m.rpc.mockReset();
  m.report.mockReset();
  m.revalidate.mockReset();
  m.role.current = 'admin';
});

describe('formatMinorFixed (X-14, rule 4)', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [100, '1.00'],
    [120050, '1200.50'],
    [-750, '-7.50'],
    [-5, '-0.05'],
    [9007199254740991, '90071992547409.91'],
  ])('%i minor units is %s', (minor, text) => {
    expect(formatMinorFixed(minor)).toBe(text);
  });

  it('refuses anything but a safe integer', () => {
    expect(() => formatMinorFixed(1.5)).toThrow();
    expect(() => formatMinorFixed(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe('the pure helpers', () => {
  it('reads only real calendar days', () => {
    expect(dayFrom('2026-11-20')).toBe('2026-11-20');
    expect(dayFrom('2026-02-30')).toBeNull();
    expect(dayFrom('0000-01-01')).toBeNull();
    expect(dayFrom('1999-12-31')).toBeNull();
    expect(dayFrom('20261120')).toBeNull();
    expect(dayFrom(undefined)).toBeNull();
  });

  it('names the one deadline each state extends (X-5)', () => {
    expect(extendableDeadline('SELECTED', true)).toBe('payment');
    expect(extendableDeadline('COMMISSION_PAID', true)).toBe('fee');
    expect(extendableDeadline('COMMISSION_PAID', false)).toBeNull();
    expect(extendableDeadline('AWAITING_CONFIRMATION', true)).toBe('confirm');
    expect(extendableDeadline('OPEN', false)).toBeNull();
  });

  it('offers the cancel only before AWAITING_CONFIRMATION (R-3)', () => {
    expect(['OPEN', 'SELECTED', 'COMMISSION_PAID', 'UNLOCKED', 'IN_PROGRESS'].every(adminMayCancel)).toBe(
      true,
    );
    expect(['AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'].some(adminMayCancel)).toBe(false);
  });
});

describe('lib/admin-requests (R-11)', () => {
  it('lists with the filters as named arguments and parses strictly', async () => {
    m.rpc.mockResolvedValueOnce(ok({ rows: [LIST_ROW], total: 1 }));
    const list = await listRequests({
      status: 'OPEN',
      region: 'TR',
      from: null,
      to: null,
      hasFlag: true,
      page: 2.7,
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_requests', {
      p_status: 'OPEN',
      p_region: 'TR',
      p_from: null,
      p_to: null,
      p_has_flag: true,
      p_page: 2,
    });
    expect(list).toEqual({ rows: [LIST_ROW], total: 1 });
  });

  it('refuses a list row carrying personal data', async () => {
    m.rpc.mockResolvedValueOnce(ok({ rows: [{ ...LIST_ROW, phone: '+905550000000' }], total: 1 }));
    await expect(
      listRequests({ status: null, region: null, from: null, to: null, hasFlag: null, page: 1 }),
    ).rejects.toThrow();
  });

  it('returns a refused filter as its code', async () => {
    m.rpc.mockResolvedValueOnce(refuse('validation_failed'));
    expect(
      await listRequests({ status: null, region: null, from: null, to: null, hasFlag: null, page: 1 }),
    ).toEqual({
      ok: false,
      code: 'validation_failed',
    });
  });

  it('cancels with ids, a code and the reason, never an amount', async () => {
    m.rpc.mockResolvedValueOnce(ok({ status: 'ok', replayed: false }));
    expect(
      await cancelRequest({ requestId: REQUEST, attributedTo: 'provider', reason: 'No show, called twice.' }),
    ).toEqual({
      ok: true,
      replayed: false,
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_cancel_request', {
      p_request_id: REQUEST,
      p_attributed_to: 'provider',
      p_reason: 'No show, called twice.',
    });
  });

  it.each(['not_cancellable', 'checkout_open', 'reason_required'])(
    'maps the cancel refusal %s',
    async (code) => {
      m.rpc.mockResolvedValueOnce(refuse(code));
      expect(
        await cancelRequest({ requestId: REQUEST, attributedTo: 'platform', reason: 'x'.repeat(12) }),
      ).toEqual({
        ok: false,
        code,
      });
    },
  );

  it('extends and returns the new deadline', async () => {
    m.rpc.mockResolvedValueOnce(ok({ status: 'ok', which: 'fee', deadline: AT }));
    expect(
      await extendDeadline({ requestId: REQUEST, which: 'fee', hours: 4, reason: 'The provider asked.' }),
    ).toEqual({
      ok: true,
      deadline: AT,
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_extend_deadline', {
      p_request_id: REQUEST,
      p_which: 'fee',
      p_hours: 4,
      p_reason: 'The provider asked.',
    });
  });

  it.each(['already_extended', 'deadline_after_start', 'invalid_state'])(
    'maps the extension refusal %s',
    async (code) => {
      m.rpc.mockResolvedValueOnce(refuse(code));
      expect(
        await extendDeadline({ requestId: REQUEST, which: 'payment', hours: 2, reason: 'x'.repeat(12) }),
      ).toEqual({
        ok: false,
        code,
      });
    },
  );

  it('shows the line only from a strict answer', async () => {
    m.rpc.mockResolvedValueOnce(ok({ line: 'Moda Cad. No 7' }));
    expect(await showAddress({ requestId: REQUEST, reason: 'The provider is lost.' })).toEqual({
      ok: true,
      address: { line: 'Moda Cad. No 7' },
    });
    // Spec 0011-20b AC-7: the parts and the pin come with the line.
    const parts = {
      line: 'Caferağa Mah., Moda Cad., No: 7, 34710 Kadıköy/İstanbul',
      il: 'İstanbul',
      ilce: 'Kadıköy',
      mahalle: 'Caferağa',
      street: 'Moda Cad.',
      building_no: '7',
      floor: null,
      apartment: null,
      postal_code: '34710',
      directions: 'Mavi kapı',
      lat: 40.98,
      lng: 29.03,
    };
    m.rpc.mockResolvedValueOnce(ok(parts));
    expect(await showAddress({ requestId: REQUEST, reason: 'The provider is lost.' })).toEqual({
      ok: true,
      address: parts,
    });
    m.rpc.mockResolvedValueOnce(ok({ line: 'Moda Cad. No 7', phone: '+90' }));
    await expect(showAddress({ requestId: REQUEST, reason: 'The provider is lost.' })).rejects.toThrow();
    m.rpc.mockResolvedValueOnce(refuse('not_available'));
    expect(await showAddress({ requestId: REQUEST, reason: 'The provider is lost.' })).toEqual({
      ok: false,
      code: 'not_available',
    });
  });

  it('lists and clears flags', async () => {
    const row = {
      id: FLAG,
      kind: 'start_late',
      raised_at: AT,
      request_id: REQUEST,
      region: 'TR',
      request_status: 'UNLOCKED',
      timezone: 'Europe/Istanbul',
    };
    m.rpc.mockResolvedValueOnce(ok({ rows: [row], total: 1 }));
    expect(await listFlags(1)).toEqual({ rows: [row], total: 1 });
    m.rpc.mockResolvedValueOnce(ok({ status: 'ok', flag_id: FLAG }));
    expect(await clearFlag({ flagId: FLAG, note: 'Called, on the way.' })).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenLastCalledWith('admin_clear_flag', {
      p_flag_id: FLAG,
      p_note: 'Called, on the way.',
    });
    m.rpc.mockResolvedValueOnce(refuse('already_cleared'));
    expect(await clearFlag({ flagId: FLAG, note: 'Called, on the way.' })).toEqual({
      ok: false,
      code: 'already_cleared',
    });
  });
});

describe('the actions (AC-9)', () => {
  it.each(['customer', 'provider'] as const)('refuse a %s before any database call', async (role) => {
    m.role.current = role;
    for (const action of [
      () =>
        adminCancelRequestAction({ requestId: REQUEST, attributedTo: 'platform', reason: 'x'.repeat(12) }),
      () =>
        adminExtendDeadlineAction({ requestId: REQUEST, which: 'payment', hours: 2, reason: 'x'.repeat(12) }),
      () => adminShowAddressAction({ requestId: REQUEST, reason: 'x'.repeat(12) }),
      () => adminClearFlagAction({ flagId: FLAG, note: 'x'.repeat(12) }),
    ]) {
      expect(await action()).toEqual({ success: false, error: 'forbidden' });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('refuse hours outside 1 to 48 and an unknown attribution before the database', async () => {
    expect(
      await adminExtendDeadlineAction({
        requestId: REQUEST,
        which: 'payment',
        hours: 49,
        reason: 'x'.repeat(12),
      }),
    ).toMatchObject({ success: false });
    expect(
      await adminCancelRequestAction({ requestId: REQUEST, attributedTo: 'admin', reason: 'x'.repeat(12) }),
    ).toMatchObject({ success: false });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('return the line to the caller without revalidating anything', async () => {
    m.rpc.mockResolvedValueOnce(ok({ line: 'Moda Cad. No 7' }));
    expect(await adminShowAddressAction({ requestId: REQUEST, reason: 'The provider is lost.' })).toEqual({
      success: true,
      data: { address: { line: 'Moda Cad. No 7' } },
    });
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it('pass a mapped refusal through as its code', async () => {
    m.rpc.mockResolvedValueOnce(refuse('checkout_open'));
    expect(
      await adminCancelRequestAction({
        requestId: REQUEST,
        attributedTo: 'platform',
        reason: 'x'.repeat(12),
      }),
    ).toEqual({ success: false, error: 'checkout_open' });
  });
});

describe('lib/admin-revenue and the CSV (R-9, R-10, X-14)', () => {
  it('loads with the range and grain only, and parses strictly', async () => {
    m.rpc.mockResolvedValueOnce(ok(REPORT));
    expect(await loadRevenue({ from: '2026-11-01', to: '2026-11-20', grain: 'day' })).toEqual({
      ok: true,
      report: REPORT,
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_revenue', {
      p_from: '2026-11-01',
      p_to: '2026-11-20',
      p_grain: 'day',
    });
    m.rpc.mockResolvedValueOnce(ok({ ...REPORT, rows: [{ ...REVENUE_ROW, net: 1.5 }] }));
    await expect(loadRevenue({ from: '2026-11-01', to: '2026-11-20', grain: 'day' })).rejects.toThrow();
  });

  it('writes a header and integer formatted amounts', () => {
    expect(revenueCsv(REPORT as Parameters<typeof revenueCsv>[0])).toBe(
      'region,currency,period,commission_revenue,provider_fee_revenue,commission_refunds,provider_fee_refunds,psp_fees,net,late_received,late_refunded\r\n' +
        'TR,TRY,2026-11-20,100.00,50.00,100.00,50.00,7.50,-7.50,100.00,0.05\r\n',
    );
    expect(revenueFileName({ from: '2026-11-01', to: '2026-11-20', grain: 'day' })).toBe(
      'revenue-2026-11-01-2026-11-20-day.csv',
    );
  });

  it('serves the CSV to admin, never cached', async () => {
    m.rpc.mockResolvedValueOnce(ok(REPORT));
    const response = await GET(
      new NextRequest('http://localhost/api/admin/revenue?from=2026-11-01&to=2026-11-20&grain=day'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain('revenue-2026-11-01-2026-11-20-day.csv');
    expect(await response.text()).toContain('TR,TRY,2026-11-20,100.00');
  });

  it.each([
    [null, 401],
    ['customer', 403],
    ['provider', 403],
  ] as const)('refuses %s with %i before any database call', async (role, status) => {
    m.role.current = role;
    const response = await GET(
      new NextRequest('http://localhost/api/admin/revenue?from=2026-11-01&to=2026-11-20&grain=day'),
    );
    expect(response.status).toBe(status);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it.each([
    'from=2026-11-01&to=2026-11-20',
    'from=x&to=2026-11-20&grain=day',
    'from=2026-11-01&to=2026-11-20&grain=week',
  ])('answers 400 to a bad query (%s)', async (search) => {
    const response = await GET(new NextRequest(`http://localhost/api/admin/revenue?${search}`));
    expect(response.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('answers 400 to a range Postgres refuses', async () => {
    m.rpc.mockResolvedValueOnce(refuse('validation_failed'));
    const response = await GET(
      new NextRequest('http://localhost/api/admin/revenue?from=2026-01-01&to=2026-11-20&grain=day'),
    );
    expect(response.status).toBe(400);
  });
});
