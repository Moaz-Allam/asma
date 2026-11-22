import 'server-only';

import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import type { Role } from '@/lib/auth/roles';
import { localized } from '@/lib/catalog/localized';
import { createSupabaseServer } from '@/lib/db/server';
import { dayParts, instantLabel } from '@/lib/requests/view';

import {
  dayGroup,
  dayKey,
  isNoticeKind,
  noticeHref,
  timeAgo,
  type NoticeKind,
  type NoticeView,
} from './kinds';

/**
 * The notification centre's one door (spec 0011-18 AC-5 to AC-7, R-8). Each wrapper calls a definer function as the
 * signed in user, which reads `auth.uid()`; no recipient id, link or region ever comes from the client. Rows hold ids
 * only (R-5): the title and line are rendered here, in the reader's current locale, from `NoticeKinds`.
 */

const UUID = z.string().uuid();

const Row = z.object({
  id: UUID,
  kind: z.string(),
  created_at: z.string(),
  read_at: z.string().nullable(),
  request_id: UUID.nullable(),
  entity_id: UUID.nullable(),
  deadline_at: z.string().nullable(),
  service_name: z.unknown().nullable(),
  timezone: z.string(),
  default_locale: z.string(),
});
export type NoticeRow = z.infer<typeof Row> & { kind: NoticeKind };

const Opened = z.array(
  z.object({ kind: z.string(), request_id: UUID.nullable(), entity_id: UUID.nullable() }),
);

export type { NoticeView } from './kinds';

function messageOf(error: unknown): string | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' ? message : null;
}

/** AC-5: the caller's own notices, newest first. A cursor that is not theirs falls back to the first page (X-10). */
export async function loadNotices(input: { before?: string | null; limit: number }): Promise<NoticeRow[]> {
  const supabase = await createSupabaseServer();
  const before = input.before && UUID.safeParse(input.before).success ? input.before : null;
  let { data, error } = await supabase.rpc('my_notices', {
    p_before: before ?? undefined,
    p_limit: input.limit,
  });
  if (error && before && messageOf(error) === 'not_found') {
    ({ data, error } = await supabase.rpc('my_notices', { p_limit: input.limit }));
  }
  if (error) throw error;
  return z
    .array(Row)
    .parse(data)
    .filter((row): row is NoticeRow => isNoticeKind(row.kind));
}

/** AC-5: the unread count, capped at 100. */
export async function noticeCount(): Promise<number> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc('my_notice_count');
  if (error) throw error;
  return z.number().int().min(0).parse(data);
}

/** AC-6, AC-7: mark one read (once) and say where it leads, from the database's own row. */
export async function openNotice(
  id: string,
  role: Role,
): Promise<{ ok: true; href: string } | { ok: false; code: 'not_found' }> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc('open_notice', { p_id: id });
  if (error) {
    if (messageOf(error) === 'not_found') return { ok: false, code: 'not_found' };
    throw error;
  }
  const [row] = Opened.parse(data);
  if (!row || !isNoticeKind(row.kind)) return { ok: false, code: 'not_found' };
  return {
    ok: true,
    href: noticeHref(row.kind, { requestId: row.request_id, entityId: row.entity_id }, role),
  };
}

/** AC-6: every unread notice of the caller, read. */
export async function markAllRead(): Promise<number> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc('mark_all_notices_read');
  if (error) throw error;
  return z.number().int().min(0).parse(data);
}

/**
 * Spec 0011-19a AC-14 (review F1): a reminder's `deadline_at` is the end of `valid_until` in the region's time zone
 * (the next local midnight), so its line names the day before that instant, as the mail names `valid_until`.
 */
function lastValidDay(deadline: string, timezone: string, locale: string): string {
  const day = dayKey(new Date(new Date(deadline).getTime() - 60_000), timezone);
  return dayParts(day, locale).long;
}

/** R-5, AC-12: the rows as the reader sees them, in their locale, with their links. */
export async function renderNotices(
  rows: readonly NoticeRow[],
  context: { locale: string; role: Role; now: Date },
): Promise<NoticeView[]> {
  const t = await getTranslations({ locale: context.locale, namespace: 'NoticeKinds' });
  const tUi = await getTranslations({ locale: context.locale, namespace: 'Notices' });
  return rows.map((row) => {
    const service = localized(row.service_name, context.locale, row.default_locale) || tUi('yourRequest');
    const withDeadline = row.deadline_at !== null && t.has(`${row.kind}.lineDeadline`);
    const line = withDeadline
      ? t(`${row.kind}.lineDeadline`, {
          service,
          deadline:
            row.kind === 'document_expiring'
              ? lastValidDay(row.deadline_at as string, row.timezone, context.locale)
              : instantLabel(row.deadline_at as string, row.timezone, context.locale),
        })
      : t(`${row.kind}.line`, { service });
    return {
      id: row.id,
      title: t(`${row.kind}.title`),
      line,
      ago: timeAgo(row.created_at, context.now, context.locale),
      unread: row.read_at === null,
      group: dayGroup(row.created_at, context.now, row.timezone),
      href: noticeHref(row.kind, { requestId: row.request_id, entityId: row.entity_id }, context.role),
    };
  });
}
