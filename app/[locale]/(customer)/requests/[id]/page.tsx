import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NextStepPanel } from '@/components/features/requests/NextStepPanel';
import { OfferCard } from '@/components/features/requests/OfferCard';
import { OfferList } from '@/components/features/requests/OfferList';
import { RequestActions } from '@/components/features/requests/RequestActions';
import { rowStatus, toneOf } from '@/components/features/requests/RequestRow';
import { RequestTimeline } from '@/components/features/requests/RequestTimeline';
import { EmptyState } from '@/components/shared/EmptyState';
import { PriceCard } from '@/components/shared/PriceCard';
import { StatusChip } from '@/components/shared/StatusChip';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { getMyRequest, loadOffers } from '@/lib/requests';
import { instantLabel, NUMBER_LOCALE, quoteLines, regionDefaultLocale } from '@/lib/requests/view';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * One of the caller's own requests (spec 0008 AC-14): the status, the review rows and the price card from the
 * stored snapshots, never the live catalog, Cancel while OPEN or SELECTED and Repeat unless live OPEN. Another
 * customer's id, an unknown id and a malformed id are all the 404 page. Spec 0010 adds the offers and the
 * choose while OPEN, the chosen provider and the next step once SELECTED, and the timeline.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['customer', 'admin']);
  const query = await searchParams;
  const [found, offers] = await Promise.all([getMyRequest({ userId: user.id, id }), loadOffers(id)]);
  if (!found || !offers) notFound();

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

  const monthYear = (date: string | null) =>
    date
      ? t('offers.since', {
          date: new Intl.DateTimeFormat(NUMBER_LOCALE[locale] ?? locale, {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${date}T12:00:00Z`)),
        })
      : null;
  const since = Object.fromEntries(
    offers.offers.map((o) => [o.application_id, monthYear(o.approved_since) ?? '']),
  );
  const chosen = offers.chosen;
  // One read decides every 06 branch: the offers' own status, so a choose or cancel between the two reads never mixes states.
  const current = offers.status;
  const liveOpen = current === 'OPEN' && status === 'OPEN';
  const timeline = [
    { key: 'posted', label: t('timeline.posted'), at: instantLabel(request.created_at, timezone, locale) },
    ...(offers.selected_at
      ? [
          {
            key: 'chosen',
            label: t('timeline.chosen'),
            at: instantLabel(offers.selected_at, timezone, locale),
          },
        ]
      : []),
    ...(offers.cancelled_at
      ? [
          {
            key: 'cancelled',
            label: t('timeline.cancelled'),
            at: instantLabel(offers.cancelled_at, timezone, locale),
          },
        ]
      : []),
    ...(offers.status === 'SELECTED' ? [{ key: 'payment', label: t('timeline.payment'), at: null }] : []),
  ];

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
          {current === 'OPEN' ? (
            offers.offers.length > 0 ? (
              <OfferList
                requestId={request.id}
                offers={offers.offers}
                since={since}
                commission={request.commission_amount}
                cashDue={request.cash_due}
                currency={request.currency}
                windowHours={offers.payment_window_hours}
                readOnly={!liveOpen}
              />
            ) : (
              <EmptyState
                lead={t('offers.emptyLead')}
                title={t('offers.emptyTitle')}
                body={liveOpen ? t('offers.emptyBody') : t('offers.expired')}
              />
            )
          ) : null}
          {chosen ? (
            <section className="flex flex-col gap-3.5" aria-labelledby="chosen-title">
              <h2 id="chosen-title" className="font-display text-title-s text-text-primary">
                {t('offers.chosenTitle')}
              </h2>
              <ul className="flex flex-col gap-3.5">
                <OfferCard
                  name={chosen.display_name ?? t('offers.provider')}
                  verified={t('offers.verified')}
                  fresh={t('offers.new')}
                  since={monthYear(chosen.approved_since)}
                  message={chosen.message}
                  hidden={chosen.message_hidden ? t('offers.messageHidden') : null}
                  flag={
                    chosen.suspended && current === 'SELECTED'
                      ? t('offers.unavailable')
                      : chosen.status === 'CANCELLED'
                        ? t('timeline.cancelled')
                        : null
                  }
                />
              </ul>
            </section>
          ) : null}
          {current === 'SELECTED' && offers.payment_deadline ? (
            <NextStepPanel
              labels={{
                title: t('next.title'),
                commission: t('next.commission'),
                cash: t('next.cash'),
                deadline: t('next.deadline', {
                  date: instantLabel(offers.payment_deadline, timezone, locale),
                }),
                soon: t('next.soon'),
              }}
              commission={request.commission_amount}
              cashDue={request.cash_due}
              currency={request.currency}
            />
          ) : null}
          <RequestTimeline title={t('timeline.title')} steps={timeline} />
          <RequestActions
            requestId={request.id}
            canCancel={current === 'OPEN' || current === 'SELECTED'}
            canRepeat={!liveOpen && current !== 'SELECTED'}
            chosenNote={current === 'SELECTED' ? t('cancelSelected') : null}
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
