import { getTranslations } from 'next-intl/server';

import { StatusChip } from '@/components/shared/StatusChip';
import type { AdminProviderQuality } from '@/lib/admin-quality';
import { flagFigure, formatCount, formatPercent, METRIC_RATES, type Rate } from '@/lib/quality/summary';
import { instantLabel } from '@/lib/requests/view';

import { QualityAction } from './QualityAction';

/**
 * The Quality section of a provider's admin page (ui-registry `AdminQualitySection`, spec 0011-19a AC-13): jobs
 * done, all six rates with their counts ("4 of 5"), the median response time, probation and its waiver, and the last
 * 20 flags with how each was handled. Admin only; `admin_provider_quality` checks `is_admin()` again.
 */
export async function AdminQualitySection({
  data,
  locale,
  providerId,
  providerName,
}: {
  data: { state: 'ok'; quality: AdminProviderQuality } | { state: 'unavailable' };
  locale: string;
  providerId: string;
  providerName: string;
}) {
  const t = await getTranslations('Quality.admin');
  if (data.state === 'unavailable') {
    return (
      <section aria-labelledby="quality-title" className="flex flex-col gap-2">
        <h2 id="quality-title" className="font-display text-title-s text-text-primary">
          {t('section')}
        </h2>
        <p className="text-body-s text-text-secondary">{t('unavailable')}</p>
      </section>
    );
  }
  const { metrics, probation, waiver, flags, timezone } = data.quality;
  const rate = (value: Rate) =>
    value.pct === null
      ? t('countOf', { num: value.num, den: value.den })
      : `${t('countOf', { num: value.num, den: value.den })} (${formatPercent(value.pct, locale)})`;
  const rows: Array<[string, string]> = [
    [t('metric.jobs_done'), formatCount(metrics.jobs_done, locale)],
    ...METRIC_RATES.map((key) => [t(`metric.${key}`), rate(metrics[key])] as [string, string]),
    [
      t('metric.response'),
      metrics.response_minutes
        ? t('minutes', { minutes: metrics.response_minutes.minutes, count: metrics.response_minutes.count })
        : '—',
    ],
  ];

  return (
    <section aria-labelledby="quality-title" className="flex flex-col gap-4">
      <h2 id="quality-title" className="font-display text-title-s text-text-primary">
        {t('section')}
      </h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-meta text-text-secondary">{label}</dt>
            <dd className="text-body-s font-semibold text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-meta text-text-secondary">{t('windowNote', { days: metrics.window_days })}</p>

      {probation ? (
        <div className="flex flex-col gap-2 rounded-block bg-accent-light p-4">
          <p className="text-body-s font-bold text-text-primary">
            {t('progress', { done: probation.jobs_done, needed: probation.jobs_needed })}
          </p>
          <p className="text-body-s text-text-primary">
            {t('live', { live: probation.live, limit: probation.live_limit })}
          </p>
          <div className="flex flex-wrap items-start gap-2.5">
            <QualityAction
              mode="end"
              targetId={providerId}
              provider={providerName}
              figure={t('progress', { done: probation.jobs_done, needed: probation.jobs_needed })}
            />
          </div>
        </div>
      ) : null}

      {waiver ? (
        <div className="flex flex-col gap-1 rounded-block bg-surface-secondary p-4">
          <p className="text-body-s font-bold text-text-primary">
            {t('waived', {
              name: waiver.by_name ?? t('unnamed'),
              date: instantLabel(waiver.at, timezone, locale),
            })}
          </p>
          <p className="text-body-s break-words whitespace-pre-line text-text-primary">{waiver.note}</p>
        </div>
      ) : null}

      <h3 className="text-meta font-bold text-text-secondary">{t('flagsTitle')}</h3>
      {flags.length === 0 ? (
        <p className="text-body-s text-text-secondary">{t('noFlags')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {flags.map((flag) => {
            const words = flagFigure(flag.kind, flag.figure, locale);
            return (
              <li key={flag.id} className="flex flex-col gap-1.5 rounded-row bg-surface-secondary px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={flag.outcome ? 'neutral' : 'negative'} label={t(`kind.${flag.kind}`)} />
                  <span className="text-meta text-text-secondary">
                    {t('raised', { date: instantLabel(flag.raised_at, timezone, locale) })}
                  </span>
                </div>
                <p className="text-body-s text-text-primary">
                  {t(words.key as 'figure.rating', words.values)}
                </p>
                {flag.outcome && flag.handled_at ? (
                  <p className="text-body-s text-text-primary">
                    {t('handled', {
                      outcome: t(`outcome.${flag.outcome}`),
                      name: flag.handled_by_name ?? t('unnamed'),
                      date: instantLabel(flag.handled_at, timezone, locale),
                    })}
                  </p>
                ) : null}
                {flag.note ? (
                  <p className="text-body-s break-words whitespace-pre-line text-text-secondary">
                    {flag.note}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
