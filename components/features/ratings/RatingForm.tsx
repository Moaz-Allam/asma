'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { rateProviderAction } from '@/actions/requests';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { useRouter } from '@/lib/i18n/navigation';
import {
  RATING_DIMENSIONS,
  type RatingDimension,
  type RatingScore,
  type RatingScores,
} from '@/lib/ratings/summary';

import { RatingScoresRow, RatingStars } from './RatingStars';

type Picks = Record<RatingDimension, RatingScore | null>;
const EMPTY: Picks = { punctuality: null, quality: null, professionalism: null, value: null };

/**
 * "Your rating" on a COMPLETED request (ui-registry `RatingForm`, s9, spec 0011-17 AC-6): optional, four rows of
 * stars, Send once all four are picked; after the send, or when a rating exists, the scores read only with the day
 * it was given. The note says it changes no payment and can't be changed. `already_rated` from a second tab
 * refreshes the page, which then shows the stored rating. No comment field (decision 3).
 */
export function RatingForm({
  requestId,
  until,
  rating,
}: {
  requestId: string;
  /** "You can rate until …", in the region's time zone, or null. */
  until: string | null;
  /** The stored rating and "You rated on …", or null while the form shows. */
  rating: { scores: RatingScores; ratedOn: string } | null;
}) {
  const t = useTranslations('Ratings');
  const router = useRouter();
  const hydrated = useHydrated();
  const [picks, setPicks] = useState<Picks>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const complete = RATING_DIMENSIONS.every((d) => picks[d] !== null);

  function send() {
    const { punctuality, quality, professionalism, value } = picks;
    if (punctuality === null || quality === null || professionalism === null || value === null) return;
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof rateProviderAction>>;
      try {
        result = await rateProviderAction({ requestId, punctuality, quality, professionalism, value });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (result.success) {
        track('rating_submitted', {});
        router.refresh();
        return;
      }
      const key = `errors.${result.error}`;
      setError(t.has(key) ? t(key as 'errors.action_failed') : t('errors.action_failed'));
      // Only a rating sent from another tab is worth a reload: the page then shows it. Any other refusal keeps the
      // section and its message on screen (slice review 2026-11-22), since a reload would remove both.
      if (result.error === 'already_rated') router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="rating-title"
      className="flex flex-col gap-4 rounded-panel border-2 border-border-light bg-surface p-5 lg:p-6"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id="rating-title" className="font-display text-title-s text-text-primary">
          {t('form.title')}
        </h2>
        {rating ? null : <StatusChip tone="neutral" label={t('form.optional')} />}
      </div>
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      {rating ? (
        <>
          <p className="text-body-s text-text-secondary">{rating.ratedOn}</p>
          <div className="flex flex-col gap-3">
            {RATING_DIMENSIONS.map((d) => (
              <RatingScoresRow
                key={d}
                label={t(`dimensions.${d}`)}
                score={rating.scores[d]}
                name={t('star', { score: rating.scores[d] })}
              />
            ))}
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <p className="rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
            {t('form.note')}
          </p>
          {until ? <p className="text-body-s text-text-secondary">{until}</p> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            {RATING_DIMENSIONS.map((d) => (
              <RatingStars
                key={d}
                name={`rating-${d}`}
                legend={t(`dimensions.${d}`)}
                value={picks[d]}
                onChange={(score) => setPicks((current) => ({ ...current, [d]: score }))}
                starLabel={(score) => t('star', { score })}
                disabled={busy}
              />
            ))}
          </div>
          {complete ? null : (
            <p id="rating-hint" className="text-meta text-text-secondary">
              {t('form.pickAll')}
            </p>
          )}
          <Button
            type="submit"
            className="self-start"
            disabled={!hydrated || !complete || busy}
            aria-describedby={complete ? undefined : 'rating-hint'}
          >
            {busy ? t('form.sending') : t('form.send')}
          </Button>
        </form>
      )}
    </section>
  );
}
