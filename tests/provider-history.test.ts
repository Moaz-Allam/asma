import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-15, the provider's jobs and fees history. The rules live in `provider_history` and are proven in pgTAP
 * 32; here the database answer is a stub, so each branch of the door can be driven: the one argument (no provider
 * id, no figure, R-7, R-10), the strict parse that refuses a contact field (R-9), the refusal codes (X-2), the month
 * parser (R-10), the tab helper against 11's sets in the migration (R-11, X-13), the menu entry and its label
 * (R-12, X-12), and the banned words under `History.*` in every locale (R-13, AC-3).
 */

const m = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: vi.fn() }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { loadHistory } from '@/lib/provider-feed';
import {
  APPLICATION_STATUSES,
  JOB_TAB_STATUSES,
  JOB_TABS,
  historyMonthParam,
  jobTabFor,
  parseHistoryMonth,
} from '@/lib/provider-feed/constants';
import { menuFor, menuLabelKey, PROVIDER_LINKS, PROVIDER_NAV } from '@/lib/navigation/menus';
import { monthLabel } from '@/lib/requests/view';

const CTX = { region: 'TR' as const };
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001', hint: null } });

const ROW = {
  application_id: '00000000-0000-4000-8000-0000000000e1',
  request_id: '00000000-0000-4000-8000-0000000000d1',
  scheduled_start_at: '2026-11-15T07:00:00+00:00',
  service_name: { tr: 'Temizlik', en: 'Cleaning' },
  application_status: 'UNLOCKED',
  request_status: 'UNLOCKED',
  cash_due: 90000,
  fee_amount: 5000,
  receipt_id: '00000000-0000-4000-8000-0000000000f1',
  refund_state: 'none',
  refund_amount: null,
};
const HISTORY = {
  month: '2026-11-01',
  timezone: 'Europe/Istanbul',
  currency: 'TRY',
  months: ['2026-11-01', '2026-10-01'],
  totals: { jobs: 1, fees_paid: 5000, refunds: 0, net_fees: 5000, cash_closed: 0 },
  truncated: false,
  rows: [ROW],
};

beforeEach(() => {
  m.rpc.mockReset();
});

describe('loadHistory (R-7, R-9, R-10, X-2)', () => {
  it('sends only the month and parses the whole result', async () => {
    m.rpc.mockResolvedValue({ data: HISTORY, error: null });
    const result = await loadHistory('2026-11-01', CTX);
    expect(m.rpc).toHaveBeenCalledWith('provider_history', { p_month: '2026-11-01' });
    expect(result).toEqual({ ok: true, history: HISTORY });
  });

  it('sends null for the current month', async () => {
    m.rpc.mockResolvedValue({ data: HISTORY, error: null });
    await loadHistory(null, CTX);
    expect(m.rpc).toHaveBeenCalledWith('provider_history', { p_month: null });
  });

  it('reads a fee of 0 with no receipt, a pending refund and a cancelled job', async () => {
    const rows = [
      { ...ROW, fee_amount: 0, receipt_id: null },
      { ...ROW, refund_state: 'pending' },
      {
        ...ROW,
        request_status: 'CANCELLED',
        application_status: 'CANCELLED',
        refund_state: 'done',
        refund_amount: 5000,
      },
    ];
    m.rpc.mockResolvedValue({ data: { ...HISTORY, rows }, error: null });
    const result = await loadHistory(null, CTX);
    expect(result.ok && result.history.rows).toHaveLength(3);
  });

  it.each(['customer_phone', 'address_line', 'customer_name', 'notes', 'zone_name'])(
    'refuses a row carrying %s (R-9: money, not contact data)',
    async (key) => {
      m.rpc.mockResolvedValue({ data: { ...HISTORY, rows: [{ ...ROW, [key]: 'x' }] }, error: null });
      await expect(loadHistory(null, CTX)).rejects.toThrow();
    },
  );

  it.each(['balance', 'available', 'held'])('refuses a total named %s (rule 9)', async (key) => {
    m.rpc.mockResolvedValue({ data: { ...HISTORY, totals: { ...HISTORY.totals, [key]: 1 } }, error: null });
    await expect(loadHistory(null, CTX)).rejects.toThrow();
  });

  it('refuses a fractional figure (rule 4)', async () => {
    m.rpc.mockResolvedValue({ data: { ...HISTORY, rows: [{ ...ROW, fee_amount: 50.5 }] }, error: null });
    await expect(loadHistory(null, CTX)).rejects.toThrow();
  });

  it.each(['forbidden', 'validation_failed'])('maps %s to a code', async (code) => {
    m.rpc.mockResolvedValue(refuse(code));
    expect(await loadHistory('2020-01-01', CTX)).toEqual({ ok: false, code });
  });

  it('throws an unknown error', async () => {
    m.rpc.mockResolvedValue(refuse('boom'));
    await expect(loadHistory(null, CTX)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('the month (R-10)', () => {
  it.each([
    ['2026-11', '2026-11-01'],
    ['2025-01', '2025-01-01'],
    ['2026-12', '2026-12-01'],
  ])('reads %s', (value, expected) => {
    expect(parseHistoryMonth(value)).toBe(expected);
  });

  it.each([
    '2026-13',
    '2026-00',
    '0000-01',
    '9999-01',
    '2026-1',
    '2026-11-05',
    'november',
    '',
    undefined,
    ['2026-11'],
  ])('falls back to the current month for %s', (value) => {
    expect(parseHistoryMonth(value)).toBeNull();
  });

  it('writes the link value back', () => {
    expect(historyMonthParam('2026-11-01')).toBe('2026-11');
  });

  it('labels a month in each locale, never in Turkish case for an id', () => {
    expect(monthLabel('2026-11-01', 'en')).toBe('November 2026');
    expect(monthLabel('2026-11-01', 'tr')).toBe('Kasım 2026');
    expect(monthLabel('2026-11-01', 'ar')).toContain('2026');
  });
});

describe('the tab helper (R-11, X-13)', () => {
  it('puts every application status in exactly one tab', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(
        JOB_TABS.filter((tab) => JOB_TAB_STATUSES[tab].includes(status)),
        status,
      ).toHaveLength(1);
    }
  });

  it('agrees with the sets of provider_jobs in Postgres', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261123090000_work_and_close.sql'),
      'utf8',
    );
    for (const tab of JOB_TABS) {
      const match = new RegExp(`when '${tab}'\\s+then array\\[([^\\]]+)\\]`).exec(sql);
      expect(match, tab).not.toBeNull();
      const statuses = [...(match?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((found) => found[1]);
      expect(statuses, tab).toEqual([...JOB_TAB_STATUSES[tab]]);
    }
  });

  it.each([
    ['UNLOCKED', 'active'],
    ['STARTED', 'active'],
    ['COMPLETED', 'active'],
    ['CONFIRMED', 'done'],
    ['RATED', 'done'],
    ['CANCELLED', 'done'],
  ] as const)('links %s to %s', (status, tab) => {
    expect(jobTabFor(status)).toBe(tab);
  });
});

describe('the menu (R-12, X-12)', () => {
  it('is in the header and the home links, not a phone tab', () => {
    expect(PROVIDER_NAV.find((item) => item.key === 'history')?.href).toBe('/provider/history');
    expect(PROVIDER_LINKS.some((item) => item.key === 'history')).toBe(true);
    expect(menuFor('provider').some((item) => item.key === 'history')).toBe(false);
  });

  it('reads its label from History.nav', () => {
    expect(menuLabelKey('history')).toBe('History.nav');
    expect(menuLabelKey('feed')).toBe('Nav.feed');
  });
});

describe('the banned words (R-13, AC-3)', () => {
  const EN = ['balance', 'wallet', 'withdraw', 'earning', 'payout', 'held'];
  const BANNED: Record<string, string[]> = {
    en: EN,
    // The Turkish file holds English lines under the `[tr]` marker until translated (D100), so both lists apply.
    tr: [...EN, 'bakiye', 'cüzdan', 'para çek', 'kazanç'],
    ar: ['رصيد', 'محفظة', 'سحب', 'أرباح'],
  };
  const strings = (value: unknown, path: string): [string, string][] =>
    typeof value === 'string'
      ? [[path, value]]
      : Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
          strings(inner, `${path}.${key}`),
        );

  it.each(Object.keys(BANNED))('History.* in %s has none', (locale) => {
    const messages = JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8')) as {
      History?: unknown;
    };
    expect(messages.History, locale).toBeDefined();
    const found = strings(messages.History, 'History').flatMap(([path, text]) =>
      // Case folded without a Turkish locale (rule 10): "I" never becomes a dotless "ı".
      (BANNED[locale] ?? [])
        .filter((word) => text.toLowerCase().includes(word.toLowerCase()))
        .map((word) => `${path}: ${word}`),
    );
    expect(found).toEqual([]);
  });
});
