import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { HandleReportForm, type RefundableFee } from '@/components/features/admin/reports/HandleReportForm';
import { ReportPhotoButton } from '@/components/features/admin/reports/ReportPhotoButton';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip } from '@/components/shared/StatusChip';
import { loadReport } from '@/lib/admin-reports';
import { loadAdminRequest } from '@/lib/admin-requests';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { REPORT_OUTCOMES, type ReportOutcome } from '@/lib/reports/constants';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';

/** Report text, admin notes and photos render here; never cached. */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }> };

const REVEALED = ['UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'];

/**
 * One report (spec 0011-14 AC-4, AC-5, X-22): the reason, the text, the dates, the request summary and its fees
 * from 12's `admin_request_detail`, both sides with their past counts (this report left out), the photos behind
 * Show (each view audited, X-3), and the handle form while the report is open. A malformed or unknown id is 404.
 */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const detail = await loadReport(id);
  if (!detail) notFound();
  const request = await loadAdminRequest(detail.report.request_id);
  if (!request) notFound();

  const t = await getTranslations('AdminReports');
  const tReasons = await getTranslations('Reports.reasons');
  const { report, parties, photos } = detail;
  const summary = request.request;
  const tz = summary.timezone;
  const at = (value: string | null) => (value ? instantLabel(value, tz, locale) : '—');
  const text = (value: unknown) => localized(value, locale, regionDefaultLocale(summary.region));

  // The outcomes that fit: a suspension only against a provider (R-10), a return or a close only while the job waits
  // for confirmation (AC-5). Postgres refuses the rest anyway.
  const outcomes: ReportOutcome[] = REPORT_OUTCOMES.filter((outcome) => {
    if (outcome === 'suspended') return report.side === 'customer';
    if (outcome === 'returned_to_work' || outcome === 'job_closed') {
      return summary.status === 'AWAITING_CONFIRMATION';
    }
    return true;
  });
  // R-11, X-20: a paid fee not refunded yet, refundable by 12's rule; named with its payer and amount.
  const refunded = new Set(request.refunds.map((r) => r.fee_payment_id).filter(Boolean));
  const fees: RefundableFee[] = request.fees
    .filter((fee) => {
      if (fee.status !== 'paid' || refunded.has(fee.id)) return false;
      if (fee.kind === 'commission')
        return summary.status === 'CANCELLED' || REVEALED.includes(summary.status);
      return request.applications.some((a) => a.id === fee.application_id && a.unlocked_at !== null);
    })
    .map((fee) => ({
      id: fee.id,
      kind: fee.kind,
      payer: fee.kind === 'commission' ? 'customer' : 'provider',
      amount: fee.amount,
      currency: fee.currency,
    }));

  const section = 'flex flex-col gap-3 rounded-block bg-surface-secondary p-5';
  const heading = 'text-meta font-bold text-text-secondary';
  const row = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body-s';

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/admin/reports"
        className="inline-flex min-h-11 items-center self-start text-body-s font-semibold text-link"
      >
        {t('back')}
      </Link>
      <PageHeader
        title={tReasons(report.reason)}
        intro={report.side === 'customer' ? t('byCustomer') : t('byProvider')}
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <section className={section} aria-labelledby="report-text">
            <h2 id="report-text" className={heading}>
              {t('text')}
            </h2>
            <p className="text-body break-words whitespace-pre-line text-text-primary">{report.text}</p>
            <p className="text-meta text-text-secondary">
              {t('reportedOn', { date: at(report.created_at) })}
              {report.handled_at ? ` · ${t('handledOn', { date: at(report.handled_at) })}` : ''}
            </p>
          </section>

          <section className={section} aria-labelledby="report-photos">
            <h2 id="report-photos" className={heading}>
              {t('photos')}
            </h2>
            {photos.length === 0 ? (
              <p className="text-body-s text-text-secondary">{t('noPhotos')}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {photos.map((photo, index) => (
                  <li key={photo.id}>
                    <ReportPhotoButton photoId={photo.id} number={index + 1} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={section} aria-labelledby="report-parties">
            <h2 id="report-parties" className={heading}>
              {t('parties')}
            </h2>
            <ul className="flex flex-col gap-3">
              {parties.map((party) => (
                <li key={party.id} className="flex flex-col gap-1">
                  <span className="text-body-s font-semibold text-text-primary">
                    {party.is_reporter ? t('reporter') : t('reported')}: {party.name} ·{' '}
                    <code>{party.role}</code>
                    {party.provider_status ? (
                      <>
                        {' '}
                        · <code>{party.provider_status}</code>
                      </>
                    ) : null}
                  </span>
                  <span className="text-meta text-text-secondary">
                    {t('counts', { filed: party.filed, against: party.against, warnings: party.warnings })}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {report.status === 'handled' ? (
            <section className={section} aria-labelledby="report-outcome">
              <h2 id="report-outcome" className={heading}>
                {t('handled', { outcome: report.outcome ? t(`outcomes.${report.outcome}`) : '—' })}
              </h2>
              <p className="text-body-s break-words text-text-primary">
                {t('note')}: {report.admin_note}
              </p>
            </section>
          ) : (
            <HandleReportForm
              reportId={report.id}
              outcomes={outcomes}
              defaultReason={report.reason}
              fees={fees}
            />
          )}
        </div>

        <aside className="flex flex-col gap-3.5">
          <section className={section} aria-labelledby="report-request">
            <h2 id="report-request" className={heading}>
              {t('request')}
            </h2>
            <dl className="flex flex-col gap-2">
              <div className={row}>
                <dt className="text-text-secondary">{t('status')}</dt>
                <dd>
                  <StatusChip tone="neutral" label={summary.status} />
                </dd>
              </div>
              <div className={row}>
                <dt className="text-text-secondary">{t('request')}</dt>
                <dd className="text-text-primary">
                  {text(summary.service_name)} · {summary.region}
                </dd>
              </div>
              <div className={row}>
                <dt className="text-text-secondary">{t('start')}</dt>
                <dd className="text-text-primary">
                  {at(summary.actual_started_at ?? summary.scheduled_start_at)}
                </dd>
              </div>
              {summary.closed_at ? (
                <div className={row}>
                  <dt className="text-text-secondary">{t('closed')}</dt>
                  <dd className="text-text-primary">
                    {at(summary.closed_at)} · {t('closedBy', { by: summary.closed_by ?? '—' })}
                  </dd>
                </div>
              ) : null}
            </dl>
            <h3 className={heading}>{t('fees')}</h3>
            {request.fees.length === 0 ? (
              <p className="text-body-s text-text-secondary">{t('noFees')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {request.fees.map((fee) => (
                  <li key={fee.id} className={row}>
                    <span className="text-text-primary">{t(`kinds.${fee.kind}`)}</span>
                    <span className="flex items-center gap-2">
                      <MoneyDisplay amount={fee.amount} currency={fee.currency} />
                      <code className="text-meta">{fee.status}</code>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/admin/requests/${summary.id}`}
              className="inline-flex min-h-11 items-center self-start text-body-s font-semibold text-link"
            >
              {t('openRequest')}
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
