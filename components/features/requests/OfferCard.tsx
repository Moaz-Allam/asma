import type { ReactNode } from 'react';

import { StatusChip } from '@/components/shared/StatusChip';
import type { OfferAnswerLine } from '@/lib/requests/offer-answers';

/**
 * One offer on the customer's request (ui-registry `OfferCard`, `s6`, spec 0010 AC-1): a letter avatar, the
 * provider's first name and family initial, the "Verified" and "New" chips, how long they have been on the
 * platform, and their message (or "Message hidden"). No full name, photo or contact detail ever reaches it.
 * Since 17 (spec 0011-17 AC-5) a rated provider shows their score in place of "New" (`rating`), and a provider
 * whose score is unavailable shows neither (`fresh` null). Display only; the caller passes every string and the action.
 * Since 19b (spec 0011-19b AC-6) an application with answers shows them in place of the message: each question's
 * label and the answer, a hidden answer as its line.
 */
export function OfferCard({
  name,
  verified,
  fresh,
  since,
  message,
  hidden,
  flag,
  rating,
  quality,
  answers = null,
  answersLabel,
  action,
}: {
  name: string;
  verified: string;
  /** "New", or null when the provider is rated or the score is unavailable. */
  fresh: string | null;
  since: string | null;
  message: string | null;
  hidden: string | null;
  flag?: string | null;
  /** The provider's score line and its disclosure (`RatingSummary`), when rated. */
  rating?: ReactNode;
  /** Spec 0011-19a AC-3: jobs on Aldebyani and the two rates (`QualityLine`), under the name line. */
  quality?: ReactNode;
  /** Spec 0011-19b AC-6: the answers, rendered on the server; null for a message application. */
  answers?: OfferAnswerLine[] | null;
  answersLabel?: string;
  action?: ReactNode;
}) {
  const initial = [...name][0] ?? '';
  return (
    <li className="flex flex-col gap-4 rounded-panel border-2 border-border-light bg-surface p-5 lg:p-6">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-btn text-accent-foreground"
        >
          {initial}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-card break-words text-text-primary">{name}</p>
            <StatusChip tone="info" label={verified} />
            {fresh ? <StatusChip tone="neutral" label={fresh} /> : null}
            {flag ? <StatusChip tone="negative" label={flag} /> : null}
          </div>
          {quality}
          {since ? <p className="text-meta text-text-secondary">{since}</p> : null}
          {rating}
        </div>
      </div>
      {answers !== null ? (
        answers.length > 0 ? (
          <dl
            aria-label={answersLabel}
            className="flex flex-col gap-3 rounded-block bg-surface-secondary p-4 text-body-s"
          >
            {answers.map((answer) => (
              <div key={answer.key} className="flex flex-col gap-1">
                <dt dir="auto" className="font-semibold text-text-primary">
                  {answer.label}
                </dt>
                <dd
                  dir="auto"
                  className={
                    answer.hidden
                      ? 'text-text-secondary'
                      : 'break-words whitespace-pre-line text-text-primary'
                  }
                >
                  {answer.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null
      ) : message !== null ? (
        <p className="rounded-block bg-surface-secondary p-4 text-body-s break-words whitespace-pre-line text-text-primary">
          {message}
        </p>
      ) : hidden ? (
        <p className="rounded-block bg-surface-secondary p-4 text-body-s text-text-secondary">{hidden}</p>
      ) : null}
      {action}
    </li>
  );
}
