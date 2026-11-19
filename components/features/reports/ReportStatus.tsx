import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import type { MyReport } from '@/lib/reports';
import { instantLabel } from '@/lib/requests/view';

/**
 * The caller's own report on a job (ui-registry `ReportStatus`, spec 0011-14 AC-7): its state in one line, never
 * the outcome, and "Report a problem" while one can be filed. The other side never sees a report exists. Renders
 * nothing when there is neither.
 */
export async function ReportStatus({
  report,
  href,
  timezone,
  locale,
  showLink = true,
}: {
  report: MyReport | null;
  href: string;
  timezone: string;
  locale: string;
  /** False where the page already offers its own entry (Not done, beside Confirm). */
  showLink?: boolean;
}) {
  if (!report) return null;
  const t = await getTranslations('Reports');
  const latest = report.report;
  const line =
    latest?.status === 'open'
      ? t('statusOpen', { date: instantLabel(latest.created_at, timezone, locale) })
      : latest?.status === 'handled'
        ? t('statusHandled')
        : null;
  if (!line && !(showLink && report.can_report)) return null;
  return (
    <div className="flex flex-col gap-2">
      {line ? (
        <p role="status" className="rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
          {line}
        </p>
      ) : null}
      {showLink && report.can_report ? (
        <Button asChild variant="link" size="text" className="min-h-11 self-start">
          <Link href={href}>{t('cta')}</Link>
        </Button>
      ) : null}
    </div>
  );
}
