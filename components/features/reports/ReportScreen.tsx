import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import type { RoleUser } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { myReport } from '@/lib/reports';
import { isReportReason } from '@/lib/reports/constants';

import { ReportForm } from './ReportForm';

/**
 * The report page of either side (spec 0011-14 AC-7): `/requests/[id]/report` and
 * `/provider/applications/[requestId]/report`. A request the caller is not a party to is the 404 page; when no
 * report can be filed now, the reason is said and the form is not shown. `?reason=poor_work` preselects a chip
 * (the customer's "Not done").
 */
export async function ReportScreen({
  user,
  requestId,
  backHref,
  reason,
}: {
  user: RoleUser;
  requestId: string;
  backHref: string;
  reason: string | string[] | undefined;
}) {
  const report = await myReport(requestId);
  if (!report) notFound();
  const t = await getTranslations('Reports');
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center self-start text-body-s font-semibold text-link"
      >
        {t('form.back')}
      </Link>
      <PageHeader title={t('form.title')} intro={t('form.lead')} />
      {report.can_report ? (
        <ReportForm
          requestId={requestId}
          region={user.region ?? 'TR'}
          side={report.side}
          backHref={backHref}
          initialReason={typeof reason === 'string' && isReportReason(reason) ? reason : null}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p role="status" className="rounded-block bg-surface-secondary p-4 text-body text-text-primary">
            {report.report?.status === 'open' ? t('errors.report_open') : t('errors.not_allowed')}
          </p>
          <Button asChild variant="outline" className="self-start">
            <Link href={backHref}>{t('form.done')}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
