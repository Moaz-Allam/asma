import { getTranslations, setRequestLocale } from 'next-intl/server';

import { markAllNoticesReadAction } from '@/actions/notifications';
import { NotificationList } from '@/components/features/notifications/NotificationList';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { loadNotices, noticeCount, renderNotices } from '@/lib/notifications/centre';
import { PAGE_SIZE } from '@/lib/notifications/kinds';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ before?: string | string[] }>;
};

/**
 * `s13`, `p15`: every signed in role's notifications (spec 0011-18 AC-9, X-2). 20 at a time, newest first; "Show
 * older" carries the last id. A cursor that is not the caller's shows the first page (X-10). Each row opens its page.
 */
export default async function NotificationsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage('any');
  const t = await getTranslations('Notices');
  const query = await searchParams;
  const before = typeof query.before === 'string' ? query.before : null;
  // One more than a page tells whether an older page exists.
  const rows = await loadNotices({ before, limit: PAGE_SIZE + 1 });
  const page = rows.slice(0, PAGE_SIZE);
  const older = rows.length > PAGE_SIZE ? page.at(-1)?.id : undefined;
  const [notices, unread] = await Promise.all([
    renderNotices(page, { locale, role: user.role, now: new Date() }),
    noticeCount(),
  ]);

  // AC-9: a plain form, so "Mark all as read" works without script. The guarded action checks the caller again.
  async function markAll(formData: FormData) {
    'use server';
    await markAllNoticesReadAction(formData);
  }

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-account">
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader title={t('title')} />
        {notices.length === 0 ? (
          <EmptyState lead="0" title={t('emptyTitle')} body={t('empty')} />
        ) : (
          <NotificationList notices={notices} />
        )}
        {older ? (
          <Button asChild variant="secondary" className="self-start">
            <Link href={{ pathname: '/notifications', query: { before: older } }}>{t('showOlder')}</Link>
          </Button>
        ) : null}
      </div>
      <aside className="flex flex-col gap-3.5 max-lg:order-first">
        <section className="flex flex-col gap-2 rounded-card bg-surface-secondary px-6.5 py-5.5">
          <h2 className="text-label text-text-secondary">{t('unreadTitle')}</h2>
          <p className="font-display text-display-l text-text-primary" data-testid="notices-unread">
            {unread >= 100 ? '99+' : unread}
          </p>
          <p className="text-meta text-text-secondary">{t('unreadHint')}</p>
          {unread > 0 ? (
            <form action={markAll}>
              <Button type="submit" variant="secondary" size="nav">
                {t('markAll')}
              </Button>
            </form>
          ) : null}
        </section>
        <section className="flex flex-col gap-2 rounded-card bg-surface-secondary px-6.5 py-5.5">
          <h2 className="text-label text-text-secondary">{t('channelsTitle')}</h2>
          <p className="text-meta text-text-secondary">{t('channelsBody')}</p>
          <Link href="/account" className="text-label text-link">
            {t('channelsLink')}
          </Link>
        </section>
      </aside>
    </div>
  );
}
