import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

/** Spec 0011-18 AC-12, R-5: a notice is rendered when read, from the catalogue and the values `my_notices` returns. */

vi.mock('@/lib/db/server', () => ({ createSupabaseServer: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({ locale, messages: en as never, namespace: namespace as never }),
}));

const { renderNotices } = await import('@/lib/notifications/centre');

const NOW = new Date('2026-11-22T12:00:00Z');
const base = {
  id: '33333333-3333-4333-8333-333333333333',
  created_at: '2026-11-22T11:50:00Z',
  read_at: null,
  request_id: '11111111-1111-4111-8111-111111111111',
  entity_id: '22222222-2222-4222-8222-222222222222',
  deadline_at: null,
  service_name: { tr: 'Temizlik', en: 'Cleaning' },
  timezone: 'Europe/Istanbul',
  default_locale: 'tr',
};

describe('renderNotices', () => {
  it('a line with the service in the reader locale, the time ago, the group and the link', async () => {
    const [view] = await renderNotices([{ ...base, kind: 'new_offer' }], {
      locale: 'en',
      role: 'customer',
      now: NOW,
    });
    expect(view).toEqual({
      id: base.id,
      title: 'New offer',
      line: 'A provider sent an offer on Cleaning.',
      ago: '10 minutes ago',
      unread: true,
      group: 'today',
      href: `/requests/${base.request_id}`,
    });
  });

  it('the deadline line names the deadline in the region time zone', async () => {
    const [view] = await renderNotices(
      [{ ...base, kind: 'pay_your_fee', deadline_at: '2026-11-22T15:00:00Z' }],
      { locale: 'en', role: 'provider', now: NOW },
    );
    // 15:00 UTC is 18:00 in Istanbul.
    expect(view?.line).toContain('by Sunday, November 22 at 18:00');
    expect(view?.href).toBe('/provider/applications');
  });

  it('a deadline kind with no deadline stored reads the plain line', async () => {
    const [view] = await renderNotices([{ ...base, kind: 'please_confirm' }], {
      locale: 'en',
      role: 'customer',
      now: NOW,
    });
    expect(view?.line).toBe('The provider marked Cleaning as done. Please confirm the job.');
  });

  it('a kind with no deadline line ignores a stored deadline', async () => {
    const [view] = await renderNotices([{ ...base, kind: 'chosen', deadline_at: '2026-11-22T15:00:00Z' }], {
      locale: 'en',
      role: 'provider',
      now: NOW,
    });
    expect(view?.line).not.toContain('18:00');
  });

  it('falls back to the region default name, then to "your request"', async () => {
    const [regionDefault, none] = await renderNotices(
      [
        { ...base, kind: 'job_started', service_name: { tr: 'Temizlik' } },
        { ...base, kind: 'job_started', service_name: null },
      ],
      { locale: 'en', role: 'customer', now: NOW },
    );
    expect(regionDefault?.line).toBe('The provider started the work on Temizlik.');
    expect(none?.line).toBe('The provider started the work on your request.');
  });

  it('a read notice is not unread, and an old one is Earlier', async () => {
    const [view] = await renderNotices(
      [
        {
          ...base,
          kind: 'job_completed',
          read_at: '2026-11-20T10:00:00Z',
          created_at: '2026-11-20T09:00:00Z',
        },
      ],
      { locale: 'en', role: 'provider', now: NOW },
    );
    expect(view?.unread).toBe(false);
    expect(view?.group).toBe('earlier');
  });
});
