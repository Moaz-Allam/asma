import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Role } from '@/lib/auth/roles';
import {
  NOTICE_KINDS,
  countLabel,
  dayGroup,
  dayKey,
  noticeHref,
  timeAgo,
  type NoticeKind,
} from '@/lib/notifications/kinds';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

/** Spec 0011-18: the kinds against the migration, where each leads (AC-7), the formatting (AC-8, AC-9), the copy (AC-12). */

function migration(): string {
  const dir = 'supabase/migrations';
  const file = readdirSync(dir).find((f) => f.endsWith('_notification_centre.sql'));
  if (!file) throw new Error('notification centre migration not found');
  return readFileSync(`${dir}/${file}`, 'utf8');
}

const REQ = '11111111-1111-4111-8111-111111111111';
const ENT = '22222222-2222-4222-8222-222222222222';
const ids = { requestId: REQ, entityId: ENT };

describe('the kinds', () => {
  it('equal the check on notifications.kind', () => {
    const check =
      /constraint notifications_kind_valid check \(kind in \(([^)]*)\)\)/.exec(migration())?.[1] ?? '';
    const kinds = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(kinds.sort()).toEqual([...NOTICE_KINDS].sort());
    expect(NOTICE_KINDS).toHaveLength(24);
  });
});

describe('noticeHref (AC-7)', () => {
  const expected: Record<Role, (kind: NoticeKind) => string> = {
    customer: (kind) =>
      [
        'account_approved',
        'account_rejected',
        'account_suspended',
        'rating_received',
        'report_new_admin',
      ].includes(kind)
        ? '/notifications'
        : ['report_received', 'report_handled'].includes(kind)
          ? `/requests/${REQ}/report`
          : `/requests/${REQ}`,
    provider: (kind) =>
      ['account_approved', 'account_rejected', 'account_suspended'].includes(kind)
        ? '/provider'
        : kind === 'rating_received'
          ? '/provider/profile'
          : ['report_received', 'report_handled'].includes(kind)
            ? `/provider/applications/${REQ}/report`
            : kind === 'report_new_admin'
              ? '/notifications'
              : '/provider/applications',
    admin: (kind) => (kind === 'report_new_admin' ? `/admin/reports/${ENT}` : '/notifications'),
  };

  for (const role of ['customer', 'provider', 'admin'] as const) {
    it.each(NOTICE_KINDS)(`${role}: %s`, (kind) => {
      expect(noticeHref(kind, ids, role)).toBe(expected[role](kind));
    });
  }

  it('a missing id leads to the list', () => {
    expect(noticeHref('new_offer', { requestId: null, entityId: null }, 'customer')).toBe('/notifications');
    expect(noticeHref('report_received', { requestId: null, entityId: ENT }, 'provider')).toBe(
      '/notifications',
    );
    expect(noticeHref('report_new_admin', { requestId: REQ, entityId: null }, 'admin')).toBe(
      '/notifications',
    );
  });

  it('never builds a link from anything but an id it was given', () => {
    for (const role of ['customer', 'provider', 'admin'] as const) {
      for (const kind of NOTICE_KINDS) {
        expect(noticeHref(kind, ids, role)).toMatch(/^\/(notifications|requests|provider|admin)(\/|$)/);
      }
    }
  });
});

describe('dayGroup (AC-9)', () => {
  it('groups by the day in the region time zone, not UTC', () => {
    // 21:30 UTC is 00:30 the next day in Istanbul (UTC+3).
    const now = new Date('2026-11-22T21:30:00Z');
    expect(dayKey(now, 'Europe/Istanbul')).toBe('2026-11-23');
    expect(dayGroup('2026-11-22T21:10:00Z', now, 'Europe/Istanbul')).toBe('today');
    expect(dayGroup('2026-11-22T20:50:00Z', now, 'Europe/Istanbul')).toBe('earlier');
    expect(dayGroup('2026-11-22T20:50:00Z', now, 'UTC')).toBe('today');
  });
});

describe('countLabel (AC-8)', () => {
  it('hides the badge at 0 and caps at 99+', () => {
    expect(countLabel(0)).toBeNull();
    expect(countLabel(-1)).toBeNull();
    expect(countLabel(Number.NaN)).toBeNull();
    expect(countLabel(3)).toBe('3');
    expect(countLabel(99)).toBe('99');
    expect(countLabel(100)).toBe('99+');
  });
});

describe('timeAgo (AC-9)', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  it('reads minutes, hours, days and weeks', () => {
    expect(timeAgo('2026-11-22T11:59:30Z', now, 'en')).toBe('now');
    expect(timeAgo('2026-11-22T11:50:00Z', now, 'en')).toBe('10 minutes ago');
    expect(timeAgo('2026-11-22T09:00:00Z', now, 'en')).toBe('3 hours ago');
    expect(timeAgo('2026-11-21T12:00:00Z', now, 'en')).toBe('yesterday');
    expect(timeAgo('2026-11-08T12:00:00Z', now, 'en')).toBe('2 weeks ago');
  });
  it('a time in the future reads now, never a negative', () => {
    expect(timeAgo('2026-11-22T12:05:00Z', now, 'en')).toBe('now');
  });
  it('keeps Western digits in Arabic', () => {
    expect(timeAgo('2026-11-22T09:00:00Z', now, 'ar')).toMatch(/3/);
    expect(timeAgo('2026-11-22T09:00:00Z', now, 'ar')).not.toMatch(/[٠-٩]/);
  });
});

describe('the copy (AC-12)', () => {
  const DEADLINE_KINDS = [
    'pay_your_fee',
    'please_confirm',
    'pay_window_closing',
    'closes_soon',
    'rate_provider',
  ];
  const catalogues = { ar, en, tr } as const;

  for (const [locale, messages] of Object.entries(catalogues)) {
    const kinds = (messages as { NoticeKinds: Record<string, Record<string, string>> }).NoticeKinds;

    it(`${locale}: every kind has a title and a line, and only known placeholders`, () => {
      expect(Object.keys(kinds).sort()).toEqual([...NOTICE_KINDS].sort());
      for (const kind of NOTICE_KINDS) {
        const entry = kinds[kind];
        expect(entry?.title, `${locale} ${kind}`).toBeTruthy();
        expect(entry?.line, `${locale} ${kind}`).toBeTruthy();
        for (const text of Object.values(entry ?? {})) {
          const names = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
          expect(
            names.every((name) => name === 'service' || name === 'deadline'),
            `${locale} ${kind}`,
          ).toBe(true);
        }
        expect(entry?.line ?? '', `${locale} ${kind}`).not.toContain('{deadline}');
      }
    });

    it(`${locale}: a deadline line exists exactly for the kinds that store a deadline`, () => {
      const withDeadline = NOTICE_KINDS.filter((kind) => kinds[kind]?.lineDeadline !== undefined);
      expect(withDeadline.sort()).toEqual([...DEADLINE_KINDS].sort());
      for (const kind of DEADLINE_KINDS) expect(kinds[kind]?.lineDeadline).toContain('{deadline}');
    });
  }

  it('Turkish waits for the translator, marked [tr] (D58, D100)', () => {
    for (const kind of NOTICE_KINDS) {
      expect(tr.NoticeKinds[kind].title.startsWith('[tr] ')).toBe(true);
    }
  });
});
