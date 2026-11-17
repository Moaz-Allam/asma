import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0009, the provider's door (`lib/provider-feed`) and its actions. The rules themselves are proven in
 * pgTAP (14, 15); here the database answers are stubs, so each branch can be driven on purpose: the alert
 * on `apply_settings_invalid` only (AC-11), the strict parse that refuses a key the functions must never
 * send (AC-7), the field of a setup refusal, the cursors, the date chips, and a message that never reaches
 * an event (AC-20).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  alert: vi.fn(),
  report: vi.fn(),
  requireRole: vi.fn(),
  revalidate: vi.fn(),
  sentryCapture: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc, from: m.from })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));

import { applyToRequest as applyAction, saveProviderSetup } from '@/actions/provider-feed';
import { applyToRequest, listApplications, loadFeed, loadRequest, saveSetup } from '@/lib/provider-feed';
import { codePoints, dateRange, dayOrder, parseWhen, todayIn } from '@/lib/provider-feed/constants';
import { decodeFeedCursor, encodeFeedCursor } from '@/lib/provider-feed/cursor';
import { scrubEvent } from '@/lib/observability/scrub';

const PROVIDER = '00000000-0000-4000-8000-0000000000a1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const SERVICE = '00000000-0000-4000-8000-000000000501';
const ZONE = '00000000-0000-4000-8000-000000000201';
const APPLICATION = {
  id: '00000000-0000-4000-8000-0000000000e1',
  status: 'APPLIED',
  created_at: '2026-11-17T08:00:00.123456+00:00',
};
const CONTEXT = { region: 'TR' as const };
const MESSAGE = 'I can start on Saturday morning with two people.';

const ROW = {
  id: REQUEST,
  service_id: SERVICE,
  zone_id: ZONE,
  service_name: { tr: 'Ev temizliği' },
  zone_name: { tr: 'Kadıköy' },
  addon_names: [{ tr: 'Cam' }],
  scheduled_start_at: '2026-11-19T07:00:00+00:00',
  scheduled_end_at: '2026-11-19T12:00:00+00:00',
  fixed_price: 350000,
  cash_due: 315000,
  currency: 'TRY',
  applied_count: 1,
  cap: 10,
  full: false,
  outside_hours: false,
  application: null,
};

const refuse = (message: string, details: string | null = null) => ({
  data: null,
  error: { message, details, code: 'P0001' },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ id: PROVIDER, role: 'provider', region: 'TR' });
});

describe('loadFeed (AC-5 to AC-7)', () => {
  it('passes filters and no bounds for all, and returns a cursor when there is more', async () => {
    m.rpc.mockResolvedValue({
      data: { timezone: 'Europe/Istanbul', has_more: true, rows: [ROW] },
      error: null,
    });
    const result = await loadFeed(
      { serviceIds: [SERVICE], zoneIds: null, when: 'all', after: 'garbage' },
      'tr',
      CONTEXT,
    );
    expect(m.rpc).toHaveBeenCalledWith('provider_feed', {
      p_service_ids: [SERVICE],
      p_zone_ids: null,
      p_from: null,
      p_to: null,
      p_after_outside: null,
      p_after_start: null,
      p_after_id: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeFeedCursor(result.next)).toEqual({
      outside: false,
      start: ROW.scheduled_start_at,
      id: REQUEST,
    });
  });

  it('refuses a row carrying a key the functions must never send', async () => {
    m.rpc.mockResolvedValue({
      data: { timezone: 'Europe/Istanbul', has_more: false, rows: [{ ...ROW, notes: 'FIXTURE_NOTES' }] },
      error: null,
    });
    await expect(
      loadFeed({ serviceIds: null, zoneIds: null, when: 'all', after: null }, 'tr', CONTEXT),
    ).rejects.toThrow();
  });

  it('reads the region time zone for a date chip and sends region local bounds', async () => {
    m.from.mockReturnValue({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { timezone: 'Europe/Istanbul' }, error: null }) }),
      }),
    });
    m.rpc.mockResolvedValue({
      data: { timezone: 'Europe/Istanbul', has_more: false, rows: [] },
      error: null,
    });
    await loadFeed({ serviceIds: null, zoneIds: null, when: 'week', after: null }, 'en', CONTEXT);
    const args = m.rpc.mock.calls[0]?.[1] as Record<string, string>;
    expect(m.from).toHaveBeenCalledWith('regions');
    expect(args.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${args.p_from}T12:00:00Z`).getUTCDay()).toBe(1);
  });

  it('alerts on apply_settings_invalid and maps it', async () => {
    m.rpc.mockResolvedValue(refuse('apply_settings_invalid'));
    const result = await loadFeed(
      { serviceIds: null, zoneIds: null, when: 'all', after: null },
      'tr',
      CONTEXT,
    );
    expect(result).toEqual({ ok: false, code: 'apply_settings_invalid' });
    expect(m.alert).toHaveBeenCalledWith('apply_settings_invalid', {
      recordId: 'provider_feed',
      region: 'TR',
    });
  });

  it('rethrows an error it does not know', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } });
    await expect(
      loadFeed({ serviceIds: null, zoneIds: null, when: 'all', after: null }, 'tr', CONTEXT),
    ).rejects.toMatchObject({
      message: 'connection reset',
    });
  });
});

describe('loadRequest (AC-8)', () => {
  it('reads nothing for a malformed id', async () => {
    expect(await loadRequest('not-a-uuid', CONTEXT)).toEqual({ ok: true, request: null });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('maps a null answer to no request, so the page shows 404', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadRequest(REQUEST, CONTEXT)).toEqual({ ok: true, request: null });
  });

  it('parses the structured answers', async () => {
    m.rpc.mockResolvedValue({
      data: {
        ...ROW,
        closed: false,
        timezone: 'Europe/Istanbul',
        answers: [{ key: 'rooms', label: { tr: 'Oda' }, type: 'number', value: 3, option_labels: null }],
      },
      error: null,
    });
    const result = await loadRequest(REQUEST, CONTEXT);
    expect(result.ok && result.request?.answers[0]?.value).toBe(3);
  });
});

describe('applyToRequest and saveSetup (AC-3, AC-10)', () => {
  it('sends the message as p_message and returns a new application', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'ok', replayed: false, application: APPLICATION },
      error: null,
    });
    const result = await applyToRequest({ requestId: REQUEST, applicationMessage: MESSAGE }, CONTEXT);
    expect(m.rpc).toHaveBeenCalledWith('apply_to_request', { p_request_id: REQUEST, p_message: MESSAGE });
    expect(result).toEqual({ ok: true, replayed: false, application: APPLICATION });
  });

  it('maps a returned refusal of the message', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'refused', code: 'contact_info_in_message' }, error: null });
    expect(await applyToRequest({ requestId: REQUEST, applicationMessage: MESSAGE }, CONTEXT)).toEqual({
      ok: false,
      code: 'contact_info_in_message',
    });
  });

  it('names the failing field of a setup refusal', async () => {
    m.rpc.mockResolvedValue(refuse('setup_invalid', 'zones'));
    expect(
      await saveSetup(
        { serviceIds: [SERVICE], zoneIds: [], workDays: [1], startHour: 8, endHour: 18 },
        CONTEXT,
      ),
    ).toEqual({ ok: false, code: 'setup_invalid', field: 'zones' });
  });

  it('lists applications with a created_at cursor', async () => {
    m.rpc.mockResolvedValue({
      data: {
        timezone: 'Europe/Istanbul',
        has_more: true,
        rows: [
          {
            ...ROW,
            applied_count: undefined,
            cap: undefined,
            full: undefined,
            outside_hours: undefined,
            application: APPLICATION,
          },
        ].map(({ applied_count: _a, cap: _c, full: _f, outside_hours: _o, ...rest }) => rest),
      },
      error: null,
    });
    const result = await listApplications(null, CONTEXT);
    expect(result.ok && result.next).toBeTruthy();
  });
});

describe('the provider feed actions', () => {
  it('a mapped refusal is a code and reaches no Sentry report', async () => {
    m.rpc.mockResolvedValue(refuse('request_full'));
    expect(await applyAction({ requestId: REQUEST, applicationMessage: MESSAGE })).toEqual({
      success: false,
      error: 'request_full',
    });
    expect(m.report).not.toHaveBeenCalled();
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('a setup refusal comes back with its field', async () => {
    m.rpc.mockResolvedValue(refuse('setup_invalid', 'hours'));
    expect(
      await saveProviderSetup({
        serviceIds: [SERVICE],
        zoneIds: [ZONE],
        workDays: [1],
        startHour: 9,
        endHour: 8 + 2,
      }),
    ).toEqual({ success: false, error: 'setup_invalid_hours' });
  });

  it('refuses an unknown key or a bare message before any database call', async () => {
    expect(await applyAction({ requestId: REQUEST, message: MESSAGE })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(
      await applyAction({ requestId: REQUEST, applicationMessage: MESSAGE, providerId: PROVIDER }),
    ).toEqual({ success: false, error: 'validation_failed' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('revalidates after a new application, not after a replay', async () => {
    m.rpc.mockResolvedValueOnce({
      data: { status: 'ok', replayed: true, application: APPLICATION },
      error: null,
    });
    await applyAction({ requestId: REQUEST, applicationMessage: MESSAGE });
    expect(m.revalidate).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({
      data: { status: 'ok', replayed: false, application: APPLICATION },
      error: null,
    });
    await applyAction({ requestId: REQUEST, applicationMessage: MESSAGE });
    expect(m.revalidate).toHaveBeenCalledWith('/', 'layout');
  });

  it('asks for the provider role', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok' }, error: null });
    await saveProviderSetup({
      serviceIds: [SERVICE],
      zoneIds: [ZONE],
      workDays: [1],
      startHour: 8,
      endHour: 18,
    });
    expect(m.requireRole).toHaveBeenCalledWith('provider');
  });
});

describe('the message never reaches an event (AC-20)', () => {
  it('an event built from a failing applyToRequest keeps no message text, at any depth', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } });
    const input = { requestId: REQUEST, applicationMessage: MESSAGE };
    await applyAction(input);
    const [, error] = m.report.mock.calls[0] ?? [];
    expect(String((error as Error).message)).not.toContain('Saturday');
    // As if a later option attached the action's body or its RPC arguments to the event.
    const event = scrubEvent({
      exception: { values: [{ type: 'Error', value: String((error as Error).message) }] },
      request: { data: input },
      extra: { input, rpc: { p_request_id: REQUEST, p_message: MESSAGE } },
      contexts: { action: { args: [input] } },
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain('Saturday');
    expect(json).toContain(REQUEST);
  });
});

describe('the pure pieces', () => {
  it('a feed cursor round trips and a malformed one reads as none', () => {
    const cursor = { outside: true, start: '2026-11-19T07:00:00.123456+00:00', id: REQUEST };
    expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor);
    for (const bad of ['', 'x', Buffer.from('2|2026-11-19T07:00:00Z|x').toString('base64url'), 42, null]) {
      expect(decodeFeedCursor(bad)).toBeNull();
    }
  });

  it('weeks start Saturday in ar and Monday in tr and en, end not included', () => {
    // 2026-11-17 is a Tuesday.
    expect(dateRange('2026-11-17', 'en', 'week')).toEqual({ from: '2026-11-16', to: '2026-11-23' });
    expect(dateRange('2026-11-17', 'tr', 'next')).toEqual({ from: '2026-11-23', to: '2026-11-30' });
    expect(dateRange('2026-11-17', 'ar', 'week')).toEqual({ from: '2026-11-14', to: '2026-11-21' });
    expect(dateRange('2026-11-14', 'ar', 'week')).toEqual({ from: '2026-11-14', to: '2026-11-21' });
    expect(dateRange('2026-11-17', 'ar', 'all')).toBeNull();
    expect(dayOrder('ar')).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(dayOrder('tr')).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("today is the region's date, not the server's", () => {
    expect(todayIn('Europe/Istanbul', new Date('2026-11-16T22:30:00Z'))).toBe('2026-11-17');
    expect(todayIn('Asia/Riyadh', new Date('2026-11-16T20:30:00Z'))).toBe('2026-11-16');
  });

  it('counts code points as Postgres does and reads an unknown chip as all', () => {
    expect(codePoints('👍🏽 iş')).toBe(5);
    expect(parseWhen('week')).toBe('week');
    expect(parseWhen('soon')).toBe('all');
    expect(parseWhen(['week'])).toBe('all');
  });
});
