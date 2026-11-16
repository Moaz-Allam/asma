import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RequestActions } from '@/components/features/requests/RequestActions';
import { rowStatus, toneOf } from '@/components/features/requests/RequestRow';
import { PriceCard } from '@/components/shared/PriceCard';
import { StatusChip } from '@/components/shared/StatusChip';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { getMyRequest } from '@/lib/requests';
import { instantLabel, quoteLines, regionDefaultLocale } from '@/lib/requests/view';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * One of the caller's own requests (spec 0008 AC-14): the status, the review rows and the price card from the
 * stored snapshots, never the live catalog, Cancel while OPEN and Repeat unless live OPEN. Another customer's
 * id, an unknown id and a malformed id are all the 404 page. Position 06 adds the applicants here.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['customer', 'admin']);
  const query = await searchParams;
  const found = await getMyRequest({ userId: user.id, id });
  if (!found) notFound();

  const t = await getTranslations('Requests');
  const { request, addressLine, now } = found;
  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const text = (value: unknown) => localized(value, locale, fallback);
  const timezone = request.region_info.timezone;
  const snapshot = request.pricing_snapshot;
  const status = rowStatus(request.status, request.scheduled_start_at, now);
  const questions = request.questions_snapshot;

  const answerText = (key: string): string => {
    const value = request.answers[key];
    const q = questions.find((x) => x.key === key);
    if (typeof value === 'boolean') return value ? t('answers.yes') : t('answers.no');
    const label = (v: unknown) => {
      const option = q?.options?.find((o) => o.value === v);
      return option ? text(option.label) : String(v);
    };
    return Array.isArray(value) ? value.map(label).join(', ') : label(value);
  };

  const lines = quoteLines(
    snapshot.breakdown,
    {
      questions: Object.fromEntries(questions.map((q) => [q.key, text(q.label)])),
      addons: Object.fromEntries(snapshot.breakdown.addons.map((a) => [a.id, text(a.name)])),
      zones: snapshot.breakdown.zone
        ? { [snapshot.breakdown.zone.id]: text(snapshot.breakdown.zone.name) }
        : {},
    },
    { base: text(snapshot.service.name), adjustment: t('price.adjustment') },
  );

  const rows: { term: string; value: string }[] = [
    {
      term: t('review.service'),
      value: `${text(snapshot.service.category_name)} · ${text(snapshot.service.name)}`,
    },
    ...questions
      .filter((q) => request.answers[q.key] !== undefined)
      .map((q) => ({ term: text(q.label), value: answerText(q.key) })),
    {
      term: t('review.addons'),
      value:
        snapshot.breakdown.addons.length > 0
          ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(
              snapshot.breakdown.addons.map((a) => text(a.name)),
            )
          : t('review.none'),
    },
    { term: t('review.start'), value: instantLabel(request.scheduled_start_at, timezone, locale) },
    { term: t('review.end'), value: instantLabel(request.scheduled_end_at, timezone, locale) },
    { term: t('review.district'), value: snapshot.breakdown.zone ? text(snapshot.breakdown.zone.name) : '' },
    { term: t('review.line'), value: addressLine ?? '' },
    { term: t('review.notes'), value: request.notes ?? t('review.none') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/requests"
        className="inline-flex min-h-11 items-center self-start text-body-s font-semibold text-link"
      >
        {t('detail.back')}
      </Link>
      {query.posted === '1' && request.status === 'OPEN' ? (
        <p
          role="status"
          className="rounded-block bg-success-light p-4 text-body font-semibold text-success-foreground"
        >
          {t('detail.posted')}
        </p>
      ) : null}
      <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3">
            <StatusChip tone={toneOf(status)} label={t(`status.${status}`)} className="self-start" />
            <h1 className="font-display text-title text-text-primary">{text(snapshot.service.name)}</h1>
            {request.cancel_reason ? (
              <p className="text-body-s text-text-secondary">
                {t('detail.cancelledBecause', { reason: t(`cancel.reasons.${request.cancel_reason}`) })}
              </p>
            ) : null}
          </div>
          <dl className="divide-y divide-border-light rounded-panel border border-border-light bg-surface">
            {rows.map((row) => (
              <div key={row.term} className="grid gap-1 px-5 py-4 sm:grid-cols-[1fr_2fr]">
                <dt className="text-body-s text-text-secondary">{row.term}</dt>
                <dd className="text-body-s font-semibold break-words text-text-primary">{row.value}</dd>
              </div>
            ))}
          </dl>
          <RequestActions
            requestId={request.id}
            canCancel={request.status === 'OPEN'}
            canRepeat={!(request.status === 'OPEN' && status === 'OPEN')}
          />
        </div>
        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
          <PriceCard
            eyebrow={t('price.eyebrow')}
            figures={{
              price: request.fixed_price,
              commission: request.commission_amount,
              cashDue: request.cash_due,
              currency: request.currency,
              lines,
            }}
            labels={{
              online: t('price.online'),
              cash: t('price.cash'),
              total: t('price.total'),
              breakdown: t('price.breakdown'),
            }}
          />
        </aside>
      </div>
    </div>
  );
}
