import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-19a, the app side of trust and quality: the shared shapes and wording (`lib/quality/summary`), the
 * provider's door (`loadMyQuality`) and the probation read after a refusal, admin's door (`lib/admin-quality`) and
 * its actions, the warning reasons the banner and the suspension read (X-13), and `MyQualityCard`. The figures and
 * every rule are proven in pgTAP (38, 39); here the database answers are stubs, so each branch is driven on purpose.
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  alert: vi.fn(),
  report: vi.fn(),
  requireRole: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })) }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));

import { endProbationAction, handleQualityFlagAction } from '@/actions/admin-quality';
import { loadMyProbation } from '@/actions/provider-feed';
import { MyQualityCard } from '@/components/features/quality/MyQualityCard';
import {
  endProbation,
  handleQualityFlag,
  loadFunnel,
  loadProviderQuality,
  loadQualityFlags,
} from '@/lib/admin-quality';
import { loadMyQuality } from '@/lib/provider-feed';
import { CardQuality, flagFigure, formatPercent, MyQuality, windowSpan } from '@/lib/quality/summary';
import { qualityWarningReason, WARNING_REASONS } from '@/lib/reports/constants';
import { MyWarning } from '@/lib/reports/schemas';
import en from '@/messages/en.json';

const USER = '00000000-0000-4000-8000-0000000000c1';
const PROVIDER = '00000000-0000-4000-8000-0000000000a1';
const FLAG = '00000000-0000-4000-8000-0000000000f1';
const CARD = {
  jobs_done: 12,
  completion: { pct: 92, den: 12 },
  on_time: null,
  window_days: 365,
  grace_minutes: 15,
} as const;
const PROBATION = { jobs_done: 3, jobs_needed: 5, live: 2, live_limit: 2 } as const;
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001' } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ id: USER, role: 'provider', region: 'TR' });
});

describe('the card shape (AC-3)', () => {
  it('reads the three figures and refuses any key a customer must never see', () => {
    expect(CardQuality.parse(CARD)).toEqual(CARD);
    expect(() => CardQuality.parse({ ...CARD, cancellation: { pct: 5, den: 12 } })).toThrow();
    expect(() => CardQuality.parse({ ...CARD, probation: true })).toThrow();
    expect(() => CardQuality.parse({ ...CARD, completion: { pct: 101, den: 3 } })).toThrow();
  });

  it('the provider view holds only the card and probation (AC-4)', () => {
    expect(MyQuality.parse({ quality: CARD, probation: PROBATION })).toEqual({
      quality: CARD,
      probation: PROBATION,
    });
    expect(() => MyQuality.parse({ quality: CARD, probation: null, flags: [] })).toThrow();
  });
});

describe('the wording', () => {
  it('a percentage in each locale, Western digits in Arabic (i18n §7)', () => {
    expect(formatPercent(92, 'en')).toBe('92%');
    expect(formatPercent(92, 'tr')).toBe('%92');
    expect(formatPercent(92, 'ar')).toMatch(/92/);
    expect(formatPercent(92, 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('the window reads in months for whole months or a year, else in days (X-19)', () => {
    expect(windowSpan(365)).toEqual({ unit: 'months', count: 12 });
    expect(windowSpan(180)).toEqual({ unit: 'months', count: 6 });
    expect(windowSpan(100)).toEqual({ unit: 'days', count: 100 });
  });

  it('a flag figure in words (AC-10)', () => {
    expect(flagFigure('high_cancellations', { num: 3, den: 12, pct: 25, threshold: 10 }, 'en')).toEqual({
      key: 'figure.high_cancellations',
      values: { num: '3', den: '12', pct: '25%', limit: '10%' },
    });
    expect(flagFigure('low_rating', { overall: 2.4, count: 9, threshold: 3 }, 'en')).toEqual({
      key: 'figure.rating',
      values: { overall: '2.4', count: '9', limit: '3.0' },
    });
    expect(flagFigure('probation_report', { source: 'report' }, 'en')).toEqual({
      key: 'figure.report',
      values: {},
    });
  });

  it('every flag figure key and kind has an admin string', () => {
    const admin = en.Quality.admin as unknown as {
      figure: Record<string, string>;
      kind: Record<string, string>;
    };
    for (const key of [
      'rating',
      'report',
      'request',
      'high_reports',
      'high_cancellations',
      'low_follow_through',
    ]) {
      expect(admin.figure[key], key).toBeTruthy();
    }
    expect(Object.keys(admin.kind).sort()).toEqual([
      'high_cancellations',
      'high_reports',
      'low_follow_through',
      'low_rating',
      'probation_cancel',
      'probation_report',
    ]);
  });
});

describe('warning reasons (AC-9, X-13)', () => {
  it('the banner reads a report reason or one of the five quality reasons, each with its sentence', () => {
    expect(WARNING_REASONS).toHaveLength(11);
    const warning = en.Reports.warning as Record<string, string>;
    for (const reason of WARNING_REASONS) expect(warning[reason], reason).toBeTruthy();
    expect(MyWarning.parse({ id: FLAG, reason: 'probation_issue', created_at: 'x' })?.reason).toBe(
      'probation_issue',
    );
    expect(() => MyWarning.parse({ id: FLAG, reason: 'quality:low_rating', created_at: 'x' })).toThrow();
  });

  it('a flag kind maps to its warning reason; both probation kinds read probation_issue', () => {
    expect(qualityWarningReason('low_rating')).toBe('low_rating');
    expect(qualityWarningReason('probation_report')).toBe('probation_issue');
    expect(qualityWarningReason('probation_cancel')).toBe('probation_issue');
    expect(qualityWarningReason('probation_issue')).toBeNull();
    expect(qualityWarningReason('no_show')).toBeNull();
  });
});

describe('loadMyQuality and the probation read (AC-4, AC-6)', () => {
  it('reads the caller view with no argument', async () => {
    m.rpc.mockResolvedValue({ data: { quality: CARD, probation: PROBATION }, error: null });
    expect(await loadMyQuality({ region: 'TR' })).toEqual({
      ok: true,
      quality: { quality: CARD, probation: PROBATION },
    });
    expect(m.rpc).toHaveBeenCalledWith('my_provider_quality', {});
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('alerts when the card is unavailable, and maps forbidden', async () => {
    m.rpc.mockResolvedValue({ data: { quality: null, probation: null }, error: null });
    await loadMyQuality({ region: 'TR' });
    expect(m.alert).toHaveBeenCalledWith('quality_settings_invalid', {
      recordId: 'my_provider_quality',
      region: 'TR',
    });
    m.rpc.mockResolvedValue(refuse('forbidden'));
    expect(await loadMyQuality({ region: 'TR' })).toEqual({ ok: false, code: 'forbidden' });
  });

  it('the apply form reads only probation, and only as a provider', async () => {
    m.rpc.mockResolvedValue({ data: { quality: CARD, probation: PROBATION }, error: null });
    expect(await loadMyProbation({})).toEqual({ success: true, data: { probation: PROBATION } });
    expect(m.requireRole).toHaveBeenCalledWith('provider');
  });
});

describe('lib/admin-quality (AC-9 to AC-13)', () => {
  it('a page is clamped and parsed strictly', async () => {
    const row = {
      id: FLAG,
      kind: 'high_reports',
      figure: { num: 2, den: 8, pct: 25, threshold: 15 },
      raised_at: '2026-11-22T08:00:00+00:00',
      provider_id: PROVIDER,
      provider_name: 'Ayşe Kaya',
      standing: 'approved',
      region: 'TR',
      timezone: 'Europe/Istanbul',
    };
    m.rpc.mockResolvedValue({ data: { rows: [row], total: 1 }, error: null });
    expect((await loadQualityFlags(0)).rows).toHaveLength(1);
    expect(m.rpc).toHaveBeenCalledWith('admin_quality_flags', { p_page: 1 });
    m.rpc.mockResolvedValue({ data: { rows: [{ ...row, note: 'x' }], total: 1 }, error: null });
    await expect(loadQualityFlags(1)).rejects.toThrow();
    m.rpc.mockResolvedValue(refuse('forbidden'));
    await expect(loadFunnel()).rejects.toThrow('forbidden');
  });

  it('handle names the flag, the outcome and the note, never a figure', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok', outcome: 'warned' }, error: null });
    expect(await handleQualityFlag({ flagId: FLAG, outcome: 'warned', note: 'Spoke with them.' })).toEqual({
      ok: true,
      outcome: 'warned',
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_handle_quality_flag', {
      p_flag_id: FLAG,
      p_outcome: 'warned',
      p_note: 'Spoke with them.',
    });
    m.rpc.mockResolvedValue(refuse('already_handled'));
    expect(await handleQualityFlag({ flagId: FLAG, outcome: 'cleared', note: 'Fine now, ok.' })).toEqual({
      ok: false,
      code: 'already_handled',
    });
    expect(await handleQualityFlag({ flagId: 'nope', outcome: 'cleared', note: 'x' })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('end probation maps already_waived; an unknown provider page section reads null', async () => {
    m.rpc.mockResolvedValue(refuse('already_waived'));
    expect(await endProbation({ providerId: PROVIDER, note: 'Known to us.' })).toEqual({
      ok: false,
      code: 'already_waived',
    });
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await loadProviderQuality(PROVIDER)).toBeNull();
    m.rpc.mockResolvedValue(refuse('quality_settings_invalid'));
    expect(await loadProviderQuality(PROVIDER)).toEqual({ state: 'unavailable' });
    expect(m.alert).toHaveBeenCalledWith('quality_settings_invalid', { recordId: PROVIDER });
  });

  it('the actions are admin only and refuse an outcome outside the three', async () => {
    m.requireRole.mockResolvedValue({ id: USER, role: 'admin', region: 'TR' });
    m.rpc.mockResolvedValue({ data: { status: 'ok', outcome: 'suspended' }, error: null });
    expect(
      await handleQualityFlagAction({ flagId: FLAG, outcome: 'suspended', note: 'Third report.' }),
    ).toEqual({
      success: true,
      data: { outcome: 'suspended' },
    });
    expect(m.requireRole).toHaveBeenCalledWith('admin');
    expect(
      await handleQualityFlagAction({ flagId: FLAG, outcome: 'refunded' as never, note: 'Third report.' }),
    ).toEqual({ success: false, error: 'validation_failed' });
    m.rpc.mockResolvedValue(refuse('not_on_probation'));
    expect(await endProbationAction({ providerId: PROVIDER, note: 'Known to us.' })).toEqual({
      success: false,
      error: 'not_on_probation',
    });
  });
});

describe('MyQualityCard (AC-4)', () => {
  const render = (quality: MyQuality) =>
    renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        // The provider's children are the third argument (react/no-children-prop), so the props type is cast.
        { locale: 'en', messages: en } as never,
        createElement(MyQualityCard, { quality }),
      ),
    );

  it('shows the figures as customers see them, a rate not shown yet saying so, and probation', () => {
    const html = render({ quality: CARD, probation: PROBATION });
    expect(html).toContain('Your quality');
    expect(html).toContain('92%');
    expect(html).toContain('Shown once enough jobs count');
    expect(html).toContain('Your first 5 jobs: 3 done');
    expect(html).toContain('you can hold 2 jobs at once');
    expect(html).toContain('12 months');
    expect(html).not.toMatch(/cancel(l)?ation rate|report rate|follow through|watchlist/i);
  });

  it('no probation block once it ends; unavailable figures say so', () => {
    expect(render({ quality: CARD, probation: null })).not.toContain('Your first');
    expect(render({ quality: null, probation: null })).toContain('not available');
  });
});
