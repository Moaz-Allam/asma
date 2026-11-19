import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-14, report a problem: the doors (`lib/reports`, `lib/admin-reports`) and the actions over stubbed
 * database answers, the lists the database and the code share, and AC-8's forbidden phrases. The rules themselves
 * are proven in pgTAP (30, 31).
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  sign: vi.fn(),
  revalidate: vi.fn(),
  role: { current: 'customer' as 'customer' | 'provider' | 'admin' },
}));

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })) }));
vi.mock('@/lib/storage/server', () => ({ signedLink: m.sign }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: vi.fn() }));
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

import { handleReportAction, reportPhotoLinkAction } from '@/actions/admin-reports';
import { acknowledgeWarningAction, addReportPhotoAction, openReportAction } from '@/actions/reports';
import { loadReport, loadReports } from '@/lib/admin-reports';
import { EMAIL_TEMPLATES } from '@/lib/email/types';
import { myReport, myWarning } from '@/lib/reports';
import { REPORT_OUTCOMES, REPORT_REASONS } from '@/lib/reports/constants';
import { reportPhotoPath } from '@/lib/storage/buckets';

const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const REPORT = '00000000-0000-4000-8000-0000000000e1';
const PHOTO = '00000000-0000-4000-8000-0000000000f1';
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001', hint: null } });
const MIGRATION = readFileSync('supabase/migrations/20261126090000_report_problem.sql', 'utf8');

beforeEach(() => {
  m.rpc.mockReset();
  m.sign.mockReset();
  m.role.current = 'customer';
});

describe('the parties door and actions (AC-1, AC-2, AC-6, AC-7)', () => {
  it('opens a report with the request id, the reason and the text only', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok', report_id: REPORT }, error: null });
    const result = await openReportAction({ requestId: REQUEST, reason: 'poor_work', text: 'x'.repeat(30) });
    expect(result).toEqual({ success: true, data: { reportId: REPORT } });
    expect(m.rpc).toHaveBeenCalledWith('open_report', {
      p_request_id: REQUEST,
      p_reason: 'poor_work',
      p_text: 'x'.repeat(30),
    });
  });

  it('maps each refusal to its code', async () => {
    for (const code of [
      'not_allowed',
      'report_open',
      'report_limit',
      'too_many_reports',
      'validation_failed',
    ]) {
      m.rpc.mockResolvedValue(refuse(code));
      expect(await openReportAction({ requestId: REQUEST, reason: 'other', text: 'y'.repeat(30) })).toEqual({
        success: false,
        error: code,
      });
    }
  });

  it('refuses an unknown reason and an admin before any call', async () => {
    const bad = await openReportAction({
      requestId: REQUEST,
      reason: 'rude' as 'other',
      text: 'y'.repeat(30),
    });
    expect(bad.success).toBe(false);
    m.role.current = 'admin';
    const admin = await openReportAction({ requestId: REQUEST, reason: 'other', text: 'y'.repeat(30) });
    expect(admin).toEqual({ success: false, error: 'forbidden' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('registers a photo only under the path shape X-5 allows', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok', photo_id: PHOTO, replayed: false }, error: null });
    const path = reportPhotoPath('TR', REPORT, PHOTO);
    expect(path).toBe(`TR/${REPORT}/${PHOTO}.jpg`);
    expect(await addReportPhotoAction({ reportId: REPORT, path })).toEqual({
      success: true,
      data: { replayed: false },
    });
    const climbing = await addReportPhotoAction({ reportId: REPORT, path: `TR/${REPORT}/../x.jpg` });
    expect(climbing.success).toBe(false);
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });

  it('reads my report strictly: an outcome or a note would fail the parse', async () => {
    const report = {
      id: REPORT,
      status: 'handled',
      reason: 'poor_work',
      created_at: '2026-11-19T10:00:00Z',
      handled_at: '2026-11-19T11:00:00Z',
      photos: 0,
    };
    m.rpc.mockResolvedValue({ data: { can_report: true, side: 'customer', report }, error: null });
    expect((await myReport(REQUEST))?.report?.status).toBe('handled');
    m.rpc.mockResolvedValue({
      data: { can_report: true, side: 'customer', report: { ...report, outcome: 'warned' } },
      error: null,
    });
    await expect(myReport(REQUEST)).rejects.toThrow();
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await myReport(REQUEST)).toBeNull();
    expect(await myReport('not-an-id')).toBeNull();
  });

  it('reads the warning and acknowledges it', async () => {
    m.rpc.mockResolvedValue({
      data: { id: PHOTO, reason: 'no_show', created_at: '2026-11-19T10:00:00Z' },
      error: null,
    });
    expect((await myWarning())?.reason).toBe('no_show');
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await myWarning()).toBeNull();
    m.role.current = 'provider';
    m.rpc.mockResolvedValue({ data: { status: 'ok', replayed: true }, error: null });
    expect(await acknowledgeWarningAction({ warningId: PHOTO })).toEqual({
      success: true,
      data: { replayed: true },
    });
  });
});

describe('the admin door and actions (AC-4, AC-5)', () => {
  beforeEach(() => {
    m.role.current = 'admin';
  });

  it('handles a report with no amount, only the ids, the note and the codes', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'ok', outcome: 'warned', fee_refund_id: null }, error: null });
    const result = await handleReportAction({
      reportId: REPORT,
      outcome: 'warned',
      note: 'Checked both sides of it.',
      refundPaymentId: null,
      warningReason: 'no_show',
    });
    expect(result).toEqual({ success: true, data: { outcome: 'warned', refunded: false } });
    expect(m.rpc).toHaveBeenCalledWith('handle_report', {
      p_report_id: REPORT,
      p_outcome: 'warned',
      p_note: 'Checked both sides of it.',
      p_refund_payment_id: null,
      p_warning_reason: 'no_show',
    });
  });

  it('maps the handle refusals and keeps a customer out', async () => {
    for (const code of ['already_handled', 'invalid_refund', 'already_suspended', 'provider_not_approved']) {
      m.rpc.mockResolvedValue(refuse(code));
      const result = await handleReportAction({
        reportId: REPORT,
        outcome: 'no_action',
        note: 'Checked both sides of it.',
        refundPaymentId: null,
        warningReason: null,
      });
      expect(result).toEqual({ success: false, error: code });
    }
    m.role.current = 'customer';
    expect((await reportPhotoLinkAction({ photoId: PHOTO })).success).toBe(false);
  });

  it('signs a photo only after the view row, 60 seconds', async () => {
    m.rpc.mockResolvedValue({
      data: { bucket: 'report-photos', path: `TR/${REPORT}/${PHOTO}.jpg` },
      error: null,
    });
    m.sign.mockResolvedValue('https://signed.example/x');
    expect(await reportPhotoLinkAction({ photoId: PHOTO })).toEqual({
      success: true,
      data: { url: 'https://signed.example/x' },
    });
    expect(m.rpc).toHaveBeenCalledWith('log_report_photo_view', { p_photo_id: PHOTO });
    expect(m.sign).toHaveBeenCalledWith('report-photos', `TR/${REPORT}/${PHOTO}.jpg`, 60);
    m.rpc.mockResolvedValue(refuse('forbidden'));
    m.sign.mockReset();
    expect(await reportPhotoLinkAction({ photoId: PHOTO })).toEqual({ success: false, error: 'forbidden' });
    expect(m.sign).not.toHaveBeenCalled();
  });

  it('parses the queue and the detail strictly', async () => {
    m.rpc.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
    expect(await loadReports('open', 1)).toEqual({ rows: [], total: 0 });
    expect(m.rpc).toHaveBeenCalledWith('admin_reports', { p_tab: 'open', p_page: 1 });
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await loadReport(REPORT)).toBeNull();
    expect(await loadReport('nope')).toBeNull();
  });
});

describe('the lists the database and the code share', () => {
  const sqlList = (constraint: string) => {
    const match = new RegExp(`${constraint} check \\(\\s*(?:\\w+ is null or )?\\w+ in \\(([^)]*)\\)`).exec(
      MIGRATION,
    );
    return [...(match?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };

  it('the six reasons and the five outcomes', () => {
    expect(sqlList('problem_reports_reason_valid')).toEqual([...REPORT_REASONS]);
    expect(sqlList('user_warnings_reason_valid')).toEqual([...REPORT_REASONS]);
    expect(sqlList('problem_reports_outcome_valid')).toEqual([...REPORT_OUTCOMES]);
  });

  it('queue_email knows every template lib/email renders (X-9)', () => {
    const body =
      /create or replace function public\.queue_email[\s\S]*?p_template not in \(([\s\S]*?)\) then/.exec(
        MIGRATION,
      );
    const sql = [...(body?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(sql.sort()).toEqual([...EMAIL_TEMPLATES].sort());
  });
});

describe('AC-8: no catalogue promises what we do not do', () => {
  const FORBIDDEN: Record<'en' | 'tr' | 'ar', string[]> = {
    en: ['guarantee', 'guaranteed', 'money back', 'money-back', 'we collect', 'escrow'],
    tr: ['garanti', 'emanet', 'para iade'],
    ar: ['نضمن', 'ضمان', 'مضمون'],
  };
  const strings = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];

  it.each(['en', 'tr', 'ar'] as const)('%s holds none of the phrases, in any locale casing', (locale) => {
    const catalogue = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as unknown;
    // Case folded by the catalogue's own rule (i18n.md): Turkish folds İ and I as Turkish does.
    const fold = (text: string) => text.toLocaleLowerCase(locale === 'tr' ? 'tr' : 'en');
    const texts = strings(catalogue).map(fold);
    for (const phrases of Object.values(FORBIDDEN)) {
      for (const phrase of phrases) {
        const hit = texts.find((text) => text.includes(fold(phrase)));
        expect(hit, `${locale}: "${phrase}"`).toBeUndefined();
      }
    }
  });
});
