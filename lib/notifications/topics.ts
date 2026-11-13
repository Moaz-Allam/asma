import type { Role } from '@/lib/auth/roles';

/**
 * The notice map (spec 0005 Feature design, from `project-overview.md` §24). The account page draws it and
 * position 13 sends by it. A row with a topic can be turned off; a row with none is always on, because a
 * money or deadline notice cannot be missed. The topics equal the check on `notification_preferences`:
 * tests/notifications-topics.test.ts reads it out of the migration.
 */

export const TOPICS = ['new_offer', 'new_matching_request', 'work_updates', 'ratings'] as const;
export type Topic = (typeof TOPICS)[number];

export type NoticeRow = {
  /** The label, under `Account.notices` in the catalogues. */
  key:
    | 'newRequests'
    | 'newOffers'
    | 'workUpdates'
    | 'ratings'
    | 'payments'
    | 'contactDetails'
    | 'confirmJob'
    | 'problemReports'
    | 'cancellations'
    | 'accountApproval';
  topic: Topic | null;
  roles: readonly Role[];
};

const BOTH: readonly Role[] = ['customer', 'provider'];

export const NOTICE_ROWS: readonly NoticeRow[] = [
  { key: 'newRequests', topic: 'new_matching_request', roles: ['provider'] },
  { key: 'newOffers', topic: 'new_offer', roles: ['customer'] },
  { key: 'workUpdates', topic: 'work_updates', roles: BOTH },
  { key: 'ratings', topic: 'ratings', roles: BOTH },
  { key: 'payments', topic: null, roles: BOTH },
  { key: 'contactDetails', topic: null, roles: BOTH },
  { key: 'confirmJob', topic: null, roles: ['customer'] },
  { key: 'problemReports', topic: null, roles: ['customer', 'provider', 'admin'] },
  { key: 'cancellations', topic: null, roles: BOTH },
  { key: 'accountApproval', topic: null, roles: ['provider'] },
];

export function noticeRowsFor(role: Role): readonly NoticeRow[] {
  return NOTICE_ROWS.filter((row) => row.roles.includes(role));
}
