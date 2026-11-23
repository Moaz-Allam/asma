import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Fragment } from 'react';

import { AgreementCard } from '@/components/features/agreements/AgreementCard';
import { CancelJobButton } from '@/components/features/jobs/CancelJobButton';
import { JobActionButton } from '@/components/features/jobs/JobActionButton';
import { WithdrawButton } from '@/components/features/jobs/WithdrawButton';
import { PayButton } from '@/components/features/payments/PayButton';
import { ReportStatus } from '@/components/features/reports/ReportStatus';
import { ApplicationRow } from '@/components/features/provider-feed/ApplicationRow';
import { ContactCard } from '@/components/shared/ContactCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { loadMyAgreement } from '@/lib/agreements';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { Link } from '@/lib/i18n/navigation';
import { jobCancelPreview, listJobs, type JobRow } from '@/lib/provider-feed';
import { JOB_TABS, parseJobTab, type JobTab } from '@/lib/provider-feed/constants';
import { myReport } from '@/lib/reports';
import { reportServerError } from '@/lib/observability/server';
import { loadContacts } from '@/lib/requests';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';
import { cn } from '@/lib/utils';

/** Spec 0011-10 AC-12, security review S10-12: contacts render here, so the route is never cached. */
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * My jobs (spec 0009 AC-13, spec 0011-10 AC-10, A-1, R-11): the provider's applications in four tabs, newest
 * change first, 20 a page. Chosen carries the fee frozen at the choose, its deadline and Pay (or Continue for a
 * fee of 0); Active carries the customer's contacts, which Postgres returns only after both fees (rule 2).
 * Withdraw on Applied and Chosen before the reveal, and the job's cancel on Active, follow the matrix (spec
 * 0011-12 AC-5, AC-6, AC-14).
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const query = await searchParams;
  const tab = parseJobTab(query.tab);
  const t = await getTranslations('ProviderFeed');

  const result = await listJobs(tab, typeof query.after === 'string' ? query.after : null, {
    region: user.region,
  });
  const tabHref = (value: JobTab) => `/provider/applications?tab=${value}`;
  const header = (
    <>
      <PageHeader title={t('applications.title')} intro={t('applications.intro')} />
      <nav aria-label={t('jobs.tabs')}>
        <ul className="flex flex-wrap gap-2">
          {JOB_TABS.map((value) => (
            <li key={value}>
              <Link
                href={tabHref(value)}
                aria-current={value === tab ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full px-5 py-2.5 text-btn-sm',
                  value === tab
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface-secondary text-text-primary',
                )}
              >
                {t(`jobs.tab.${value}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
  if (!result.ok) {
    return (
      <>
        {header}
        <ErrorState title={t('applications.error.title')} body={t('applications.error.body')} />
      </>
    );
  }

  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const text = (value: unknown) => localized(value, locale, fallback);
  const { rows, timezone, now } = result.page;
  const where = (row: JobRow) =>
    `${text(row.zone_name)} · ${instantLabel(row.scheduled_start_at, timezone, locale)}`;
  // Active, and a closed job in Done while the 14 day window lasts (spec 0011-11 A-3): Postgres decides (rule 2).
  const contacts =
    tab === 'active' || tab === 'done'
      ? await Promise.all(
          rows.map((row) =>
            tab === 'active' || row.application_status === 'CONFIRMED'
              ? loadContacts(row.id, { region: user.region, userId: user.id })
              : null,
          ),
        )
      : [];
  // Spec 0011-12 AC-14: what the provider's cancel would do, from the matrix, for each active job.
  const cancels =
    tab === 'active'
      ? await Promise.all(rows.map((row) => jobCancelPreview(row.id, { region: user.region })))
      : [];
  const tj = await getTranslations('Jobs');
  const ta = await getTranslations('Agreement');
  // Spec 0011-14 AC-7: the provider's own report on each revealed job (null where they are not a party).
  const reports =
    tab === 'active' || tab === 'done'
      ? await Promise.all(
          rows.map((row) =>
            myReport(row.id).catch((error: unknown) => {
              reportServerError('providerReports', error);
              return null;
            }),
          ),
        )
      : [];
  const reportHref = (requestId: string) => `/provider/applications/${requestId}/report`;
  // Spec 0011-20 AC-9: the agreement card on each active job, while Postgres still shows it (7 days, or 10 minutes
  // after the open); a job unlocked more than 7 days ago never has one, so it is not asked.
  const weekAgo = Date.parse(now) - 7 * 24 * 60 * 60 * 1000;
  const agreements =
    tab === 'active'
      ? await Promise.all(
          rows.map((row) =>
            row.unlocked_at && Date.parse(row.unlocked_at) > weekAgo
              ? loadMyAgreement(row.id).catch((error: unknown) => {
                  reportServerError('providerAgreements', error);
                  return null;
                })
              : null,
          ),
        )
      : [];

  return (
    <>
      {header}
      {rows.length === 0 ? (
        <EmptyState
          lead={t('applications.empty.lead')}
          title={t(`jobs.empty.${tab}`)}
          body={t('applications.empty.body')}
          action={
            <Button asChild size="lg">
              <Link href="/provider/feed">{t('applications.empty.action')}</Link>
            </Button>
          }
        />
      ) : tab === 'chosen' ? (
        <ul className="flex flex-col gap-3.5">
          {rows.map((row) => {
            const fee = row.provider_fee_amount ?? 0;
            const open = row.fee_deadline !== null && Date.parse(row.fee_deadline) > Date.parse(now);
            return (
              <li
                key={row.application_id}
                className="flex flex-col gap-4 rounded-panel bg-accent-light p-5 lg:p-7.5"
              >
                <div className="flex flex-col gap-1">
                  <h2 className="font-display text-title-s text-text-primary">{text(row.service_name)}</h2>
                  <p className="text-body-s text-text-secondary">{where(row)}</p>
                </div>
                <dl className="flex flex-col gap-2 rounded-block bg-surface p-4 text-body-s">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-text-secondary">{t('jobs.price')}</dt>
                    <dd className="font-semibold text-text-primary">
                      <MoneyDisplay amount={row.fixed_price} currency={row.currency} />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-text-primary">{t('jobs.fee')}</dt>
                    <dd className="font-bold text-text-primary">
                      <MoneyDisplay amount={fee} currency={row.currency} />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-text-primary">{t('jobs.cash')}</dt>
                    <dd className="font-bold text-text-primary">
                      <MoneyDisplay amount={row.cash_due} currency={row.currency} />
                    </dd>
                  </div>
                </dl>
                {open && row.fee_deadline ? (
                  <>
                    <p className="text-body font-semibold text-text-primary">
                      {t('jobs.deadline', { date: instantLabel(row.fee_deadline, timezone, locale) })}
                    </p>
                    {locale === 'ar' && fee > 0 ? (
                      <p className="text-body-s text-text-secondary">{t('jobs.cardEnglish')}</p>
                    ) : null}
                    {row.agreement_version ? (
                      <PayButton
                        target={{
                          kind: 'provider_fee',
                          applicationId: row.application_id,
                          agreementVersion: row.agreement_version,
                        }}
                        label={
                          fee === 0
                            ? t('jobs.continue')
                            : t('jobs.pay', { amount: formatMoney(fee, row.currency, locale as Locale) })
                        }
                      />
                    ) : (
                      <p role="status" className="rounded-block bg-surface p-4 text-body-s text-text-primary">
                        {ta('unavailable')}
                      </p>
                    )}
                  </>
                ) : (
                  <p role="status" className="rounded-block bg-surface p-4 text-body-s text-text-primary">
                    {t('jobs.ended')}
                  </p>
                )}
                {open && row.application_status === 'AWAITING_FEE' ? (
                  <WithdrawButton applicationId={row.application_id} status="AWAITING_FEE" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : tab === 'active' ? (
        <ul className="flex flex-col gap-3.5">
          {rows.map((row, index) => {
            const card = contacts[index];
            const agreement = agreements[index] ?? null;
            return (
              <li key={row.application_id} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="font-display text-title-s text-text-primary">{text(row.service_name)}</h2>
                  <p className="text-body-s text-text-secondary">{where(row)}</p>
                </div>
                {agreement ? (
                  <AgreementCard
                    agreementId={agreement.id}
                    number={agreement.number}
                    opened={agreement.opened}
                  />
                ) : null}
                {card ? (
                  <ContactCard contacts={card} requestId={row.id} locale={locale} fallbackLocale={fallback} />
                ) : (
                  <p
                    role="status"
                    className="rounded-block bg-surface-secondary p-4 text-body-s text-text-primary"
                  >
                    {t('jobs.contactsHidden')}
                  </p>
                )}
                {row.application_status === 'UNLOCKED' ? (
                  row.can_start ? (
                    <JobActionButton
                      move="start"
                      requestId={row.id}
                      label={tj('start')}
                      title={tj('startDialogTitle')}
                      body={tj('startDialogBody')}
                    />
                  ) : (
                    <p className="text-body-s text-text-secondary">
                      {tj('startFrom', { date: instantLabel(row.scheduled_start_at, timezone, locale) })}
                    </p>
                  )
                ) : row.application_status === 'STARTED' ? (
                  <JobActionButton
                    move="finish"
                    requestId={row.id}
                    label={tj('finish')}
                    title={tj('finishDialogTitle')}
                    body={tj('finishDialogBody')}
                  />
                ) : row.application_status === 'COMPLETED' && row.confirm_deadline ? (
                  <p
                    role="status"
                    className="rounded-block bg-surface-secondary p-4 text-body-s text-text-primary"
                  >
                    {tj('waitingCustomer', { date: instantLabel(row.confirm_deadline, timezone, locale) })}
                  </p>
                ) : null}
                <ReportStatus
                  report={reports[index] ?? null}
                  href={reportHref(row.id)}
                  timezone={timezone}
                  locale={locale}
                />
                {cancels[index]?.can_cancel ? (
                  <CancelJobButton
                    requestId={row.id}
                    feeKept={cancels[index]?.provider_fee_outcome !== 'not_paid'}
                    countsAgainst={(cancels[index]?.counts_against ?? 'nobody').startsWith('provider_')}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {rows.map((row, index) => (
            <Fragment key={row.application_id}>
              <ApplicationRow
                href={`/provider/feed/${row.id}`}
                status={row.application_status}
                statusLabel={t(`status.${row.application_status}`)}
                title={text(row.service_name)}
                where={where(row)}
                applied={t('jobs.changedOn', { date: instantLabel(row.status_changed_at, timezone, locale) })}
                note={
                  row.application_status === 'SELECTED' && row.payment_deadline
                    ? t('chosen.line', { date: instantLabel(row.payment_deadline, timezone, locale) })
                    : row.application_status === 'NOT_SELECTED'
                      ? t('chosen.notChosen')
                      : row.application_status === 'CANCELLED'
                        ? t('chosen.cancelled')
                        : null
                }
                price={row.fixed_price}
                currency={row.currency}
              />
              {tab === 'applied' &&
              (row.application_status === 'APPLIED' || row.application_status === 'SELECTED') ? (
                <li>
                  <WithdrawButton applicationId={row.application_id} status={row.application_status} />
                </li>
              ) : null}
              {reports[index]?.report || reports[index]?.can_report ? (
                <li>
                  <ReportStatus
                    report={reports[index] ?? null}
                    href={reportHref(row.id)}
                    timezone={timezone}
                    locale={locale}
                  />
                </li>
              ) : null}
              {contacts[index] ? (
                <li>
                  <ContactCard
                    contacts={contacts[index]}
                    requestId={row.id}
                    locale={locale}
                    fallbackLocale={fallback}
                  />
                </li>
              ) : null}
            </Fragment>
          ))}
        </ul>
      )}
      {result.next ? (
        <Button asChild variant="secondary" className="self-center">
          <Link href={{ pathname: '/provider/applications', query: { tab, after: result.next } }}>
            {t('applications.more')}
          </Link>
        </Button>
      ) : null}
    </>
  );
}
