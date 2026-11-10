import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NOTICE_ROWS, TOPICS, noticeRowsFor } from '@/lib/notifications/topics';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

/** Spec 0005 AC-32, AC-33: the notice map, per role, and the topics the database allows. */

function migration(): string {
  const dir = 'supabase/migrations';
  const file = readdirSync(dir).find((f) => f.endsWith('_account_notifications.sql'));
  if (!file) throw new Error('account notifications migration not found');
  return readFileSync(`${dir}/${file}`, 'utf8');
}

describe('the topics', () => {
  it('equal the check in the migration', () => {
    const check = /check \(topic in \(([^)]*)\)\)/.exec(migration())?.[1] ?? '';
    const topics = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(topics.sort()).toEqual([...TOPICS].sort());
  });

  it('each has exactly one row', () => {
    const used = NOTICE_ROWS.flatMap((row) => (row.topic ? [row.topic] : []));
    expect([...used].sort()).toEqual([...TOPICS].sort());
  });
});

describe('the rows per role', () => {
  const keys = (role: 'customer' | 'provider' | 'admin') => noticeRowsFor(role).map((row) => row.key);

  it('a customer sees offers, and no provider row', () => {
    expect(keys('customer')).toContain('newOffers');
    expect(keys('customer')).not.toContain('newRequests');
    expect(keys('customer')).not.toContain('accountApproval');
  });

  it('a provider sees new requests and approval, and no customer row', () => {
    expect(keys('provider')).toEqual(expect.arrayContaining(['newRequests', 'accountApproval']));
    expect(keys('provider')).not.toContain('newOffers');
    expect(keys('provider')).not.toContain('confirmJob');
  });

  it('an admin sees only problem reports', () => {
    expect(keys('admin')).toEqual(['problemReports']);
  });

  it('money and deadline notices cannot be turned off', () => {
    const locked = ['payments', 'contactDetails', 'confirmJob', 'cancellations', 'accountApproval'];
    for (const key of locked) expect(NOTICE_ROWS.find((row) => row.key === key)?.topic).toBeNull();
  });

  it.each([
    ['ar', ar],
    ['tr', tr],
    ['en', en],
  ])('every row has a label in %s', (_locale, messages) => {
    for (const row of NOTICE_ROWS) expect(messages.Account.notices[row.key]).toBeTruthy();
  });
});
