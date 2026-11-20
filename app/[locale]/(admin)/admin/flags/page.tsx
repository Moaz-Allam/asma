import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminReasonAction } from '@/components/features/admin/requests/AdminReasonAction';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { listFlags } from '@/lib/admin-requests';
import { ADMIN_PAGE_SIZE } from '@/lib/admin-requests/constants';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { instantLabel } from '@/lib/requests/view';

/** Admin data; never cached. */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The deadline flag queue (spec 0011-16 R-7, AC-4): open flags oldest first, 20 a page, each with its request's link
 * and a Clear button that asks for a note. A flag cleared by hand is never raised again for that request and kind.
 * `admin_flags` and `admin_clear_flag` check `is_admin()` again.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(typeof query.page === 'string' ? query.page : '1', 10) || 1);
  const { rows, total } = await listFlags(page);
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const t = await getTranslations('AdminFlags');
  const tReq = await getTranslations('AdminRequests');
  const href = (number: number) => `/admin/flags${number > 1 ? `?page=${number}` : ''}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} intro={t('lead')} />
      <p className="text-body-s text-text-secondary">{t('openCount', { count: total })}</p>
      {rows.length === 0 ? (
        <EmptyState lead={t('title')} title={t('empty')} body={t('emptyBody')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-panel border border-border-light bg-surface p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone="negative" label={tReq(`flag.${row.kind}`)} />
                <span className="text-meta text-text-secondary">
                  {row.region} · <code>{row.request_status}</code>
                </span>
              </div>
              <p className="text-body-s text-text-secondary">
                {t('raised', { date: instantLabel(row.raised_at, row.timezone, locale) })}
              </p>
              <div className="flex flex-wrap items-start gap-2.5">
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/admin/requests/${row.request_id}`}>{t('openRequest')}</Link>
                </Button>
                <AdminReasonAction mode="clear" targetId={row.id} label={tReq('flagClear')} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <nav aria-label={t('page', { page, pages })} className="flex flex-wrap items-center gap-3">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={href(page - 1)}>{t('prev')}</Link>
            </Button>
          ) : null}
          <span className="text-body-s text-text-secondary">{t('page', { page, pages })}</span>
          {page < pages ? (
            <Button asChild variant="secondary">
              <Link href={href(page + 1)}>{t('next')}</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
