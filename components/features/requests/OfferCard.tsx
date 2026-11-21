import type { ReactNode } from 'react';

import { StatusChip } from '@/components/shared/StatusChip';

/**
 * One offer on the customer's request (ui-registry `OfferCard`, `s6`, spec 0010 AC-1): a letter avatar, the
 * provider's first name and family initial, the "Verified" and "New" chips, how long they have been on the
 * platform, and their message (or "Message hidden"). No full name, photo or contact detail ever reaches it.
 * Since 17 (spec 0011-17 AC-5) a rated provider shows their score in place of "New" (`rating`), and a provider
 * whose score is unavailable shows neither (`fresh` null). Display only; the caller passes every string and the action.
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
          {since ? <p className="text-meta text-text-secondary">{since}</p> : null}
          {rating}
        </div>
      </div>
      {message !== null ? (
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
