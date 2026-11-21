import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-17, the three rating doors (`lib/requests`, `lib/provider-feed`, `lib/admin-ratings`), their actions and
 * the shared summary module. The rules are proven in pgTAP (35, 36); here the database answers are stubs, so each
 * branch can be driven on purpose: the argument names (the request id and four scores, never a provider or a
 * region), the strict parses, the refusal codes, the alert on `rating_settings_invalid` and on an `unavailable`
 * summary (AC-10), the event after a send (AC-11), and the access of each action.
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  alert: vi.fn(),
  warn: vi.fn(),
  report: vi.fn(),
  requireRole: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc, from: m.from })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/log', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));

import { hideRatingAction } from '@/actions/admin-ratings';
import { rateProviderAction } from '@/actions/requests';
import { hideRating, loadProviderRatings } from '@/lib/admin-ratings';
import { loadMyRating } from '@/lib/provider-feed';
import { barPercent, formatScore, RatingSummary } from '@/lib/ratings/summary';
import { loadOffers, loadRating, rateProvider } from '@/lib/requests';

const USER = '00000000-0000-4000-8000-0000000000c1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const PROVIDER = '00000000-0000-4000-8000-0000000000a1';
const RATING = '00000000-0000-4000-8000-0000000000f1';
const RATED = {
  state: 'rated',
  count: 26,
  overall: 4.8,
  punctuality: 4.9,
  quality: 4.7,
  professionalism: 5,
  value: 4.5,
} as const;
const OFFER = {
  application_id: '00000000-0000-4000-8000-0000000000e1',
  display_name: 'Ayşe K.',
  first_name: 'Ayşe',
  approved_since: '2026-03-01',
  message: 'I am free all week and live close by.',
  message_hidden: false,
  created_at: '2026-11-17T08:05:00+00:00',
  rating: RATED,
};
const OFFERS = {
  status: 'OPEN',
  timezone: 'Europe/Istanbul',
  payment_window_hours: 24,
  selected_at: null,
  payment_deadline: null,
  cancelled_at: null,
  offers: [OFFER],
  chosen: null,
};
const refuse = (message: string) => ({ data: null, error: { message, code: 'P0001' } });
const SCORES = { punctuality: 5, quality: 4, professionalism: 5, value: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ id: USER, role: 'customer', region: 'TR' });
});

describe('the summary shape (AC-4)', () => {
  it('reads New, a score and unavailable', () => {
    expect(RatingSummary.parse({ state: 'new', count: 3 })).toEqual({ state: 'new', count: 3 });
    expect(RatingSummary.parse(RATED)).toEqual(RATED);
    expect(RatingSummary.parse({ state: 'unavailable' })).toEqual({ state: 'unavailable' });
  });

  it('refuses a score below 5 ratings, a figure past 5, and any extra key', () => {
    expect(() => RatingSummary.parse({ ...RATED, count: 4 })).toThrow();
    expect(() => RatingSummary.parse({ ...RATED, overall: 5.1 })).toThrow();
    expect(() => RatingSummary.parse({ state: 'new', count: 2, overall: 5 })).toThrow();
    expect(() => RatingSummary.parse({ ...RATED, customer_id: USER })).toThrow();
  });

  it('writes a figure with one decimal and Western digits in every locale (i18n §7)', () => {
    expect(formatScore(4.8, 'en')).toBe('4.8');
    expect(formatScore(5, 'en')).toBe('5.0');
    expect(formatScore(4.8, 'tr')).toBe('4,8');
    expect(formatScore(4.8, 'ar')).toMatch(/^4[.,٫]8$/);
    expect(formatScore(4.8, 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('sizes a bar as the figure over 5, display only', () => {
    expect(barPercent(4.8)).toBe('96%');
    expect(barPercent(5)).toBe('100%');
    expect(barPercent(9)).toBe('100%');
  });
});

describe('rateProvider (AC-1)', () => {
  it('sends the request id and the four scores only', async () => {
    m.rpc.mockResolvedValue({ data: { rating_id: RATING }, error: null });
    expect(await rateProvider({ requestId: REQUEST, ...SCORES }, { region: 'TR', userId: USER })).toEqual({
      ok: true,
      ratingId: RATING,
    });
    expect(m.rpc).toHaveBeenCalledWith('rate_provider', {
      p_request_id: REQUEST,
      p_punctuality: 5,
      p_quality: 4,
      p_professionalism: 5,
      p_value: 3,
    });
  });

  it('reads nothing for a malformed id', async () => {
    expect(await rateProvider({ requestId: 'x', ...SCORES }, { region: 'TR', userId: USER })).toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it.each(['already_rated', 'deadline_passed', 'invalid_state', 'not_found', 'validation_failed'])(
    'maps %s to its code without an alert',
    async (code) => {
      m.rpc.mockResolvedValue(refuse(code));
      expect(await rateProvider({ requestId: REQUEST, ...SCORES }, { region: 'TR', userId: USER })).toEqual({
        ok: false,
        code,
      });
      expect(m.alert).not.toHaveBeenCalled();
    },
  );

  it('alerts on a broken rating setting (AC-10)', async () => {
    m.rpc.mockResolvedValue(refuse('rating_settings_invalid'));
    expect(await rateProvider({ requestId: REQUEST, ...SCORES }, { region: 'TR', userId: USER })).toEqual({
      ok: false,
      code: 'rating_settings_invalid',
    });
    expect(m.alert).toHaveBeenCalledWith('rating_settings_invalid', { recordId: REQUEST, region: 'TR' });
  });
});

describe('loadRating (AC-6)', () => {
  it('parses the form state and the stored rating', async () => {
    m.rpc.mockResolvedValue({
      data: {
        can_rate: false,
        rate_until: '2026-12-01T10:00:00+00:00',
        timezone: 'Europe/Istanbul',
        rating: { ...SCORES, created_at: '2026-11-21T10:00:00+00:00' },
      },
      error: null,
    });
    expect((await loadRating(REQUEST))?.rating?.quality).toBe(4);
    expect(m.rpc).toHaveBeenCalledWith('request_rating', { p_request_id: REQUEST });
  });

  it('is null for anyone else and refuses an extra key', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadRating(REQUEST)).toBeNull();
    m.rpc.mockResolvedValue({
      data: {
        can_rate: true,
        rate_until: null,
        timezone: 'Europe/Istanbul',
        rating: null,
        provider_id: PROVIDER,
      },
      error: null,
    });
    await expect(loadRating(REQUEST)).rejects.toThrow();
  });
});

describe('the offer card score (AC-5, AC-10)', () => {
  it('parses the rating on each offer', async () => {
    m.rpc.mockResolvedValue({ data: OFFERS, error: null });
    expect((await loadOffers(REQUEST))?.offers[0]?.rating).toEqual(RATED);
    expect(m.alert).not.toHaveBeenCalled();
  });

  it('alerts when a score is unavailable', async () => {
    m.rpc.mockResolvedValue({
      data: { ...OFFERS, offers: [{ ...OFFER, rating: { state: 'unavailable' } }] },
      error: null,
    });
    await loadOffers(REQUEST);
    expect(m.alert).toHaveBeenCalledWith('rating_settings_invalid', { recordId: REQUEST });
  });
});

describe('loadMyRating (AC-7)', () => {
  it('reads the caller summary with no argument', async () => {
    m.rpc.mockResolvedValue({ data: RATED, error: null });
    expect(await loadMyRating({ region: 'TR' })).toEqual({ ok: true, rating: RATED });
    expect(m.rpc).toHaveBeenCalledWith('my_provider_rating', {});
  });

  it('maps forbidden and alerts on unavailable', async () => {
    m.rpc.mockResolvedValue(refuse('forbidden'));
    expect(await loadMyRating({ region: 'TR' })).toEqual({ ok: false, code: 'forbidden' });
    m.rpc.mockResolvedValue({ data: { state: 'unavailable' }, error: null });
    await loadMyRating({ region: 'TR' });
    expect(m.alert).toHaveBeenCalledWith('rating_settings_invalid', {
      recordId: 'my_provider_rating',
      region: 'TR',
    });
  });
});

describe('admin (AC-8)', () => {
  const PAGE = {
    summary: RATED,
    total: 1,
    timezone: 'Europe/Istanbul',
    rows: [
      {
        id: RATING,
        created_at: '2026-11-21T10:00:00+00:00',
        request_id: REQUEST,
        ...SCORES,
        hide: {
          reason: 'fake',
          note: 'A fake account.',
          hidden_by_name: 'Yönetici',
          hidden_at: '2026-11-21T11:00:00+00:00',
        },
      },
    ],
  };

  it('reads one page, 1 based, and maps not_found to null', async () => {
    m.rpc.mockResolvedValue({ data: PAGE, error: null });
    expect((await loadProviderRatings(PROVIDER, 0))?.rows[0]?.hide?.reason).toBe('fake');
    expect(m.rpc).toHaveBeenCalledWith('admin_provider_ratings', { p_provider_id: PROVIDER, p_page: 1 });
    m.rpc.mockResolvedValue(refuse('not_found'));
    expect(await loadProviderRatings(PROVIDER, 1)).toBeNull();
    expect(await loadProviderRatings('x', 1)).toBeNull();
  });

  it('refuses a row carrying a customer', async () => {
    m.rpc.mockResolvedValue({
      data: { ...PAGE, rows: [{ ...PAGE.rows[0], customer_id: USER }] },
      error: null,
    });
    await expect(loadProviderRatings(PROVIDER, 1)).rejects.toThrow();
  });

  it('hides with the rating, a reason and a note, never a score', async () => {
    m.rpc.mockResolvedValue({ data: { hidden_at: '2026-11-21T11:00:00+00:00' }, error: null });
    expect(await hideRating({ ratingId: RATING, reason: 'pressure', note: 'Forced.' })).toEqual({
      ok: true,
      hiddenAt: '2026-11-21T11:00:00+00:00',
    });
    expect(m.rpc).toHaveBeenCalledWith('admin_hide_rating', {
      p_rating_id: RATING,
      p_reason: 'pressure',
      p_note: 'Forced.',
    });
    m.rpc.mockResolvedValue(refuse('already_hidden'));
    expect(await hideRating({ ratingId: RATING, reason: 'fake', note: 'Again.' })).toEqual({
      ok: false,
      code: 'already_hidden',
    });
  });
});

describe('the actions', () => {
  it('rate: customers only, the scores bounded, the code passed through', async () => {
    m.rpc.mockResolvedValue({ data: { rating_id: RATING }, error: null });
    expect(await rateProviderAction({ requestId: REQUEST, ...SCORES })).toEqual({
      success: true,
      data: { ratingId: RATING },
    });
    expect(m.requireRole).toHaveBeenCalledWith('customer');
    expect(await rateProviderAction({ requestId: REQUEST, ...SCORES, value: 6 })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    expect(await rateProviderAction({ requestId: REQUEST, ...SCORES, providerId: PROVIDER })).toEqual({
      success: false,
      error: 'validation_failed',
    });
    m.rpc.mockResolvedValue(refuse('already_rated'));
    expect(await rateProviderAction({ requestId: REQUEST, ...SCORES })).toEqual({
      success: false,
      error: 'already_rated',
    });
  });

  it('hide: admin only, the reason from the list', async () => {
    m.requireRole.mockResolvedValue({ id: USER, role: 'admin', region: 'TR' });
    m.rpc.mockResolvedValue({ data: { hidden_at: '2026-11-21T11:00:00+00:00' }, error: null });
    expect(await hideRatingAction({ ratingId: RATING, reason: 'other', note: 'Note.' })).toEqual({
      success: true,
      data: { hiddenAt: '2026-11-21T11:00:00+00:00' },
    });
    expect(m.requireRole).toHaveBeenCalledWith('admin');
    expect(await hideRatingAction({ ratingId: RATING, reason: 'low_score', note: 'Note.' })).toEqual({
      success: false,
      error: 'validation_failed',
    });
  });
});
