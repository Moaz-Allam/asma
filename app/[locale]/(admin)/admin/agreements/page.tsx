import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AgreementAdminActions } from '@/components/features/admin/AgreementAdminActions';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listAgreements } from '@/lib/admin-agreements';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { instantLabel } from '@/lib/requests/view';

/** Admin data; never cached. */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Every service agreement (spec 0011-20 AC-10): newest first, 50 a page, by number or request id, each with its number,
 * its request and live status, both names as frozen at the reveal, ready or failed, and who opened it. View is audited
 * before its 60 second link; Render again is for a failed one. A plain GET form, so search works before hydration.
 * `admin_agreements` checks `is_admin()` again.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const query = await searchParams;
  const q = one(query.q);
  const after = one(query.after);
  const t = await getTranslations('Agreement.admin');
  const outcome = await listAgreements(q, after);
  if ('ok' in outcome && outcome.code !== 'validation_failed') {
    throw new Error(`admin_agreements refused: ${outcome.code}`);
  }
  const list = 'ok' in outcome ? null : outcome;
  const next = list && list.has_more ? list.rows.at(-1)?.id : undefined;
  const nextHref = next
    ? `/admin/agreements?${new URLSearchParams({ ...(q ? { q } : {}), after: next }).toString()}`
    : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} intro={t('intro')} />
      <form
        method="get"
        className="flex flex-col gap-3 rounded-panel bg-surface-secondary p-5 sm:flex-row sm:items-end"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label htmlFor="agreement-search">{t('search')}</Label>
          <Input id="agreement-search" name="q" defaultValue={q ?? ''} maxLength={100} autoComplete="off" />
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button type="submit">{t('searchButton')}</Button>
          {q ? (
            <Button asChild variant="secondary">
              <Link href="/admin/agreements">{t('clear')}</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {list === null ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {t('errors.validation_failed')}
        </p>
      ) : list.rows.length === 0 ? (
        <EmptyState lead={t('title')} title={t('empty')} body={t('intro')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.rows.map((row) => {
            const tz = row.timezone;
            return (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-panel border border-border-light bg-surface p-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-title-s break-all text-text-primary">{row.number}</span>
                  {row.rendered_at ? (
                    <StatusChip
                      tone="info"
                      label={t('rendered', { date: instantLabel(row.rendered_at, tz, locale) })}
                    />
                  ) : row.failed ? (
                    <StatusChip tone="negative" label={t('failed')} />
                  ) : (
                    <StatusChip tone="waiting" label={t('queued')} />
                  )}
                </div>
                <dl className="grid gap-x-4 gap-y-1 text-body-s sm:grid-cols-[auto_1fr]">
                  <dt className="text-text-secondary">{t('request')}</dt>
                  <dd className="flex flex-wrap items-baseline gap-2 text-text-primary">
                    <Link
                      href={`/admin/requests/${row.request_id}`}
                      className="break-all text-link underline"
                    >
                      {row.request_id}
                    </Link>
                    <code className="text-meta">{row.request_status}</code>
                  </dd>
                  <dt className="text-text-secondary">{t('customer')}</dt>
                  <dd className="break-words text-text-primary">
                    {row.customer_name}
                    {row.customer_opened_at ? ` · ${t('openedCustomer')}` : ''}
                  </dd>
                  <dt className="text-text-secondary">{t('provider')}</dt>
                  <dd className="break-words text-text-primary">
                    {row.provider_name}
                    {row.provider_opened_at ? ` · ${t('openedProvider')}` : ''}
                  </dd>
                </dl>
                {!row.customer_opened_at && !row.provider_opened_at && row.rendered_at ? (
                  <p className="text-body-s text-text-secondary">{t('notOpened')}</p>
                ) : null}
                <AgreementAdminActions
                  agreementId={row.id}
                  number={row.number}
                  rendered={row.rendered_at !== null}
                  failed={row.failed}
                />
              </li>
            );
          })}
        </ul>
      )}
      {nextHref ? (
        <Button asChild variant="secondary" className="self-start">
          <Link href={nextHref}>{t('next')}</Link>
        </Button>
      ) : null}
    </div>
  );
}
