import type { Role } from '@/lib/auth/roles';
import { NUMBER_LOCALE } from '@/lib/requests/view';

/**
 * The in app notices (spec 0011-18): the 25 kinds (24, plus 19a's `document_expiring`), where each one leads, and the pure formatting the bell and the page
 * share. No `server-only`: nothing here reads data. The kinds equal the check on `notifications.kind`;
 * tests/notifications-kinds.test.ts reads it out of the migration.
 */

export const NOTICE_KINDS = [
  'new_offer',
  'chosen',
  'pay_your_fee',
  'commission_received',
  'contacts_ready',
  'job_started',
  'please_confirm',
  'job_completed',
  'request_cancelled',
  'pick_again',
  'pick_ended',
  'window_missed',
  'payment_too_late',
  'fee_refunded',
  'account_approved',
  'account_rejected',
  'account_suspended',
  'pay_window_closing',
  'closes_soon',
  'report_received',
  'report_new_admin',
  'report_handled',
  'rate_provider',
  'rating_received',
  // Spec 0011-19a AC-14: a required document expires soon.
  'document_expiring',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export function isNoticeKind(value: string): value is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(value);
}

/** What the bell and the page draw: every string already in the reader's locale. */
export type NoticeView = {
  id: string;
  title: string;
  line: string;
  ago: string;
  unread: boolean;
  group: 'today' | 'earlier';
  href: string;
};

/** The bell's popover and the page's batch (spec 0011-18 Value sourcing). */
export const POPOVER_SIZE = 5;
export const PAGE_SIZE = 20;
/** `my_notice_count()` stops counting at 100; the bell shows `99+` from there. */
export const COUNT_CAP = 100;

const ACCOUNT_KINDS: readonly NoticeKind[] = ['account_approved', 'account_rejected', 'account_suspended'];
const REPORT_KINDS: readonly NoticeKind[] = ['report_received', 'report_handled'];

/**
 * AC-7, X-11, X-12: where a notice leads, from the kind, its ids and the reader's role, on the server. A combination
 * that cannot happen (a missing id, a kind the role never gets) goes to the list.
 */
export function noticeHref(
  kind: NoticeKind,
  ids: { requestId: string | null; entityId: string | null },
  role: Role,
): string {
  const { requestId, entityId } = ids;
  if (role === 'admin') {
    return kind === 'report_new_admin' && entityId ? `/admin/reports/${entityId}` : '/notifications';
  }
  if (kind === 'report_new_admin') return '/notifications';
  if (role === 'provider') {
    if (ACCOUNT_KINDS.includes(kind)) return '/provider';
    if (kind === 'rating_received') return '/provider/profile';
    if (kind === 'document_expiring') return '/provider/profile/documents';
    if (REPORT_KINDS.includes(kind)) {
      return requestId ? `/provider/applications/${requestId}/report` : '/notifications';
    }
    return '/provider/applications';
  }
  // customer
  if (ACCOUNT_KINDS.includes(kind) || kind === 'rating_received' || !requestId) return '/notifications';
  if (REPORT_KINDS.includes(kind)) return `/requests/${requestId}/report`;
  return `/requests/${requestId}`;
}

/** The calendar day of an instant in a time zone, as `YYYY-MM-DD`. */
export function dayKey(iso: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** AC-9: "Today" or "Earlier", by the day in the notice region's time zone. */
export function dayGroup(createdAt: string, now: Date, timezone: string): 'today' | 'earlier' {
  return dayKey(createdAt, timezone) === dayKey(now, timezone) ? 'today' : 'earlier';
}

/** AC-8: the badge text; null hides the badge. */
export function countLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count >= COUNT_CAP ? '99+' : String(Math.floor(count));
}

/** Each unit and how many of it make the next one. Notices live 180 days, so weeks are the last unit. */
const STEPS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', Number.POSITIVE_INFINITY],
];

/** AC-9: "10 minutes ago", "yesterday", in the locale with Western digits. Under a minute reads "now". */
export function timeAgo(createdAt: string, now: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(NUMBER_LOCALE[locale] ?? locale, { numeric: 'auto' });
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(createdAt).getTime()) / 1000));
  if (seconds < 60) return rtf.format(0, 'second');
  let value = Math.floor(seconds / 60);
  for (const [unit, size] of STEPS) {
    if (value < size) return rtf.format(-value, unit);
    value = Math.floor(value / size);
  }
  return rtf.format(-value, 'week');
}
