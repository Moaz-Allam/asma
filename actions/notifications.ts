'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';

import { fail, guardedAction } from '@/lib/auth/action';
import {
  loadNotices,
  markAllRead,
  noticeCount,
  openNotice,
  renderNotices,
  type NoticeView,
} from '@/lib/notifications/centre';
import { POPOVER_SIZE } from '@/lib/notifications/kinds';

/**
 * The notification centre's actions (spec 0011-18 AC-6 to AC-8). Any signed in role; every database function reads
 * `auth.uid()` again, so an id names only the caller's own notice. A link is always computed on the server.
 */

const OpenInput = z.object({ id: z.string().uuid() }).strict();
const NoInput = z.undefined().or(z.object({}).strict());
// The mark all form posts FormData (it works without script, AC-9); nothing in it is read.
const FormInput = z.unknown();

/** AC-6, AC-7: mark one read and get where it leads. */
export const openNoticeAction = guardedAction(
  { name: 'openNotice', access: 'any_role', schema: OpenInput },
  async (input, user): Promise<{ href: string } | ReturnType<typeof fail>> => {
    const outcome = await openNotice(input.id, user.role);
    if (!outcome.ok) return fail(outcome.code);
    return { href: outcome.href };
  },
);

/** AC-8: the bell's count, again. */
export const refreshNoticeCountAction = guardedAction(
  { name: 'refreshNoticeCount', access: 'any_role', schema: NoInput },
  async (): Promise<{ count: number }> => ({ count: await noticeCount() }),
);

/** AC-8: the popover's latest five, rendered in the reader's locale. */
export const recentNoticesAction = guardedAction(
  { name: 'recentNotices', access: 'any_role', schema: NoInput },
  async (_input, user): Promise<{ notices: NoticeView[] }> => {
    const rows = await loadNotices({ limit: POPOVER_SIZE });
    const notices = await renderNotices(rows, {
      locale: await getLocale(),
      role: user.role,
      now: new Date(),
    });
    return { notices };
  },
);

/** AC-6, AC-9: every unread notice read. */
export const markAllNoticesReadAction = guardedAction(
  { name: 'markAllNoticesRead', access: 'any_role', schema: FormInput },
  async (): Promise<{ marked: number }> => {
    const marked = await markAllRead();
    revalidatePath('/', 'layout');
    return { marked };
  },
);
