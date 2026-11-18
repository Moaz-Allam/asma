import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { JobActionButton } from '@/components/features/jobs/JobActionButton';
import { PayButton } from '@/components/features/payments/PayButton';
import { NextStepPanel } from '@/components/features/requests/NextStepPanel';
import { OfferCard } from '@/components/features/requests/OfferCard';
import { OfferList } from '@/components/features/requests/OfferList';
import { RequestActions } from '@/components/features/requests/RequestActions';
import { rowStatus, toneOf } from '@/components/features/requests/RequestRow';
import { RequestTimeline } from '@/components/features/requests/RequestTimeline';
import { ContactCard } from '@/components/shared/ContactCard';
import { AgreementLine } from '@/components/shared/AgreementLine';
import { EmptyState } from '@/components/shared/EmptyState';
import { PriceCard } from '@/components/shared/PriceCard';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { Link } from '@/lib/i18n/navigation';
import { getMyRequest, loadCloseInfo, loadCommissionFee, loadContacts, loadOffers } from '@/lib/requests';
import { instantLabel, NUMBER_LOCALE, quoteLines, regionDefaultLocale } from '@/lib/requests/view';

/** Spec 0011-10 AC-12, security review S10-12: contacts render here, so the route is never cached. */
export const dynamic = 'force-dynamic';

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
  const [found, offers, fee] = await Promise.all([
    getMyRequest({ userId: user.id, id }),
    loadOffers(id),
    loadCommissionFee(id),
  ]);
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
  // Past SELECTED on the way to the reveal: the commission side is settled (paid, or 0, D171).
  const paidOn = [
    'COMMISSION_PAID',
    'UNLOCKED',
    'IN_PROGRESS',
    'AWAITING_CONFIRMATION',
    'COMPLETED',
  ].includes(current);
  // Spec 0011-10 AC-11: both fees settled; the contacts come from Postgres, which decides (rule 2).
  const revealed = ['UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'].includes(current);
  const contacts = revealed ? await loadContacts(request.id, { region: user.region, userId: user.id }) : null;
  // Spec 0011-11 AC-8, R-2, R-5: whether the job closes by itself here, and whether "Job done" may be pressed now.
  const working = ['UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION'].includes(current);
  const closeInfo = working ? await loadCloseInfo(request.id) : null;
  const tj = await getTranslations('Jobs');
  const payOpen =
    current === 'SELECTED' &&
    offers.payment_deadline !== null &&
    Date.parse(now) < Date.parse(offers.payment_deadline);
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
    // Spec 0011-09 AC-10: the commission paid (its time from the fee row; a commission of 0 has none), then the
    // provider's fee greyed while it is owed.
    ...(paidOn
      ? [
          {
            key: 'commission_paid',
            label: t('timeline.commissionPaid'),
            at: fee?.paid_at ? instantLabel(fee.paid_at, timezone, locale) : null,
            done: true,
          },
        ]
      : []),
    ...(current === 'COMMISSION_PAID'
      ? [{ key: 'provider_fee', label: t('timeline.providerFee'), at: null }]
      : []),
    // Spec 0011-10 AC-11: the provider's fee settled and the contacts shared. The customer reads no provider
    // fee row, so these steps carry no time.
    ...(revealed
      ? [
          { key: 'provider_fee', label: t('timeline.providerFee'), at: null, done: true },
          { key: 'contacts', label: t('timeline.contacts'), at: null, done: true },
        ]
      : []),
    // Spec 0011-11 AC-8, R-7: the work steps from the request's own columns. Started stays unlit when the
    // customer closed without it; the close names who closed.
    ...(request.actual_started_at
      ? [
          {
            key: 'started',
            label: t('timeline.started'),
            at: instantLabel(request.actual_started_at, timezone, locale),
          },
        ]
      : []),
    // Review F-3: the provider's Done is the one that set a confirm deadline; it stays lit after the close.
    ...(request.actual_completed_at && request.confirm_deadline
      ? [
          {
            key: 'done',
            label: t('timeline.done'),
            at: instantLabel(request.actual_completed_at, timezone, locale),
          },
        ]
      : []),
    ...(request.closed_at && current === 'COMPLETED'
      ? [
          {
            key: 'closed',
            label:
              request.closed_by === 'auto'
                ? t('timeline.closedAuto')
                : request.confirm_deadline
                  ? t('timeline.confirmed')
                  : t('timeline.closedByCustomer'),
            at: instantLabel(request.closed_at, timezone, locale),
          },
        ]
      : []),
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
                price: t('next.price'),
                commission: t('next.commission'),
                cash: t('next.cash'),
                deadline: payOpen
                  ? t('next.deadline', {
                      date: instantLabel(offers.payment_deadline, timezone, locale),
                    })
                  : undefined,
              }}
              price={request.fixed_price}
              commission={request.commission_amount}
              cashDue={request.cash_due}
              currency={request.currency}
            >
              {payOpen ? (
                <>
                  <AgreementLine />
                  {locale === 'ar' && request.commission_amount > 0 ? (
                    <p className="text-body-s text-text-secondary">{t('next.cardEnglish')}</p>
                  ) : null}
                  <PayButton
                    target={{ kind: 'commission', requestId: request.id }}
                    label={
                      request.commission_amount === 0
                        ? t('next.continue')
                        : t('next.pay', {
                            amount: formatMoney(
                              request.commission_amount,
                              request.currency,
                              locale as Locale,
                            ),
                          })
                    }
                  />
                </>
              ) : (
                <p role="status" className="rounded-block bg-surface p-4 text-body-s text-text-primary">
                  {t('next.ended')}
                </p>
              )}
            </NextStepPanel>
          ) : null}
          {current === 'COMMISSION_PAID' && request.fee_deadline ? (
            <section
              aria-labelledby="paid-title"
              className="flex flex-col gap-3 rounded-panel bg-success-light p-5 lg:p-7.5"
            >
              <h2 id="paid-title" className="font-display text-title-s text-text-primary">
                {t('next.paidTitle')}
              </h2>
              <p className="text-body text-text-primary">
                {t('next.waiting', { date: instantLabel(request.fee_deadline, timezone, locale) })}
              </p>
              {fee && fee.status !== 'pending' ? (
                <Button asChild variant="outline" className="self-start">
                  <Link href={`/receipts/${fee.id}`}>{t('next.receipt')}</Link>
                </Button>
              ) : null}
            </section>
          ) : null}
          {current === 'AWAITING_CONFIRMATION' && request.confirm_deadline ? (
            <section
              aria-labelledby="confirm-title"
              className="flex flex-col gap-3 rounded-panel bg-accent-light p-5 lg:p-7.5"
            >
              <h2 id="confirm-title" className="font-display text-title-s text-text-primary">
                {tj('confirmTitle')}
              </h2>
              <p className="text-body text-text-primary">
                {closeInfo?.auto_close_enabled
                  ? tj('closesOn', { date: instantLabel(request.confirm_deadline, timezone, locale) })
                  : tj('confirmBy', { date: instantLabel(request.confirm_deadline, timezone, locale) })}
              </p>
              <JobActionButton
                move="confirm"
                requestId={request.id}
                label={tj('confirm')}
                title={tj('confirmDialogTitle')}
                body={tj('confirmDialogBody')}
              />
            </section>
          ) : null}
          {(current === 'UNLOCKED' || current === 'IN_PROGRESS') && closeInfo?.can_mark_done ? (
            <JobActionButton
              move="mark_done"
              requestId={request.id}
              label={tj('markDone')}
              title={tj('markDoneDialogTitle')}
              body={tj('markDoneDialogBody')}
              variant="outline"
            />
          ) : null}
          {contacts ? (
            <ContactCard
              contacts={contacts}
              requestId={request.id}
              locale={locale}
              fallbackLocale={fallback}
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
