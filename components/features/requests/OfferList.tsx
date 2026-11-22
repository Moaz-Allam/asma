'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { chooseProviderAction } from '@/actions/requests';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmailNudge } from '@/components/shared/EmailNudge';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { useRouter } from '@/lib/i18n/navigation';
import type { Offer } from '@/lib/requests/schemas';

import {
  QualityDisclosure,
  QualityLine,
  QualityNote,
  showsQuality,
} from '@/components/features/quality/QualityLine';
import { RatingSummary } from '@/components/features/ratings/RatingSummary';

import { OfferCard } from './OfferCard';

/**
 * The offers on an OPEN request and the choose (ui-registry `OfferList`, `s6`, spec 0010 AC-1, AC-6, AC-8).
 * The confirm restates the deal: the commission online next within the window, the cash to the provider
 * after the service, contact details after both have paid. Every figure is the request's stored minor
 * units; the exact deadline is shown only after the choose, from the stored value.
 */
export function OfferList({
  requestId,
  offers,
  since,
  commission,
  cashDue,
  currency,
  windowHours,
  readOnly,
  emailNudge = false,
}: {
  requestId: string;
  offers: readonly Offer[];
  since: Record<string, string>;
  commission: number;
  cashDue: number;
  currency: 'TRY' | 'SAR';
  windowHours: number | null;
  readOnly: boolean;
  /** Spec 0011-13 AC-4: no confirmed email while mail is on, so the deadlines would not reach the customer. */
  emailNudge?: boolean;
}) {
  const t = useTranslations('Requests');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [picked, setPicked] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const nameOf = (offer: Offer) => offer.display_name ?? t('offers.provider');
  const firstOf = (offer: Offer) => offer.first_name ?? t('offers.provider');
  const money = (amount: number) => formatMoney(amount, currency, locale);

  function choose() {
    if (!picked) return;
    const offer = picked;
    start(async () => {
      let result: Awaited<ReturnType<typeof chooseProviderAction>>;
      try {
        result = await chooseProviderAction({ requestId, applicationId: offer.application_id });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      setPicked(null);
      if (result.success) {
        if (!result.data.replayed) track('provider_chosen', {});
        router.refresh();
        return;
      }
      setError(t(`errors.${result.error}` as 'errors.action_failed'));
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3.5" aria-labelledby="offers-title">
      <h2 id="offers-title" className="font-display text-title-s text-text-primary">
        {t('offers.title', { count: offers.length })}
      </h2>
      {readOnly ? (
        <p role="status" className="rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
          {t('offers.expired')}
        </p>
      ) : (
        <p className="text-body-s text-text-secondary">{t('offers.intro')}</p>
      )}
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3.5">
        {offers.map((offer) => (
          <OfferCard
            key={offer.application_id}
            name={nameOf(offer)}
            verified={t('offers.verified')}
            fresh={offer.rating.state === 'new' ? t('offers.new') : null}
            rating={
              offer.rating.state === 'rated' ? (
                <RatingSummary
                  rating={offer.rating}
                  note={showsQuality(offer.quality) ? <QualityNote quality={offer.quality} /> : null}
                />
              ) : showsQuality(offer.quality) ? (
                <QualityDisclosure quality={offer.quality} />
              ) : null
            }
            quality={<QualityLine quality={offer.quality} />}
            since={since[offer.application_id] ?? null}
            message={offer.message}
            hidden={offer.message_hidden ? t('offers.messageHidden') : null}
            action={
              readOnly ? null : (
                <Button
                  className="self-start"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setPicked(offer);
                  }}
                >
                  {t('offers.choose', { name: firstOf(offer) })}
                </Button>
              )
            }
          />
        ))}
      </ul>
      <ConfirmDialog
        open={picked !== null}
        onOpenChange={(open) => {
          if (!open) setPicked(null);
        }}
        title={t('offers.confirmTitle', { name: picked ? firstOf(picked) : '' })}
        body={t('offers.confirmBody')}
        confirmLabel={t('offers.confirm')}
        cancelLabel={t('offers.keep')}
        onConfirm={choose}
        busy={busy}
      >
        <ul className="flex flex-col gap-2 rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
          <li>
            {windowHours === null
              ? t('offers.confirmCommissionNoWindow', { amount: money(commission) })
              : t('offers.confirmCommission', { amount: money(commission), hours: windowHours })}
          </li>
          <li>{t('offers.confirmCash', { amount: money(cashDue) })}</li>
          <li>{t('offers.confirmContact')}</li>
        </ul>
        {emailNudge ? <EmailNudge text={t('emailBanner.text')} linkLabel={t('emailBanner.link')} /> : null}
      </ConfirmDialog>
    </section>
  );
}
