import { ArrowRight, Calendar, MapPin } from 'lucide-react';

import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { StatusChip, type ChipTone } from '@/components/shared/StatusChip';
import { Link } from '@/lib/i18n/navigation';
import type { RequestStatus } from '@/lib/requests/schemas';

/**
 * One request in `/requests` (ui-registry `RequestRow`, `s10`): the status chip, the service name, the
 * district, the start, the job price and the posted date, all from the stored snapshot. The whole card links
 * to the detail page. Display only; the page passes every string in its locale.
 */

export type RowStatus = RequestStatus | 'EXPIRED';

/** A live OPEN request reads as open; an OPEN one whose start passed reads as expired (AC-13). */
export function rowStatus(status: RequestStatus, startIso: string, nowIso: string): RowStatus {
  return status === 'OPEN' && Date.parse(startIso) <= Date.parse(nowIso) ? 'EXPIRED' : status;
}

export function toneOf(status: RowStatus): ChipTone {
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'neutral';
  if (status === 'COMPLETED') return 'info';
  return status === 'OPEN' ? 'waiting' : 'info';
}

export function RequestRow({
  href,
  status,
  statusLabel,
  title,
  district,
  start,
  posted,
  price,
  currency,
  openLabel,
}: {
  href: string;
  status: RowStatus;
  statusLabel: string;
  title: string;
  district: string;
  start: string;
  posted: string;
  price: number;
  currency: 'TRY' | 'SAR';
  openLabel?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex flex-col gap-3.5 rounded-panel border-2 border-border bg-surface p-5 transition duration-150 ease-out hover:border-accent focus-visible:ring-2 focus-visible:ring-ring lg:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusChip tone={toneOf(status)} label={statusLabel} />
          <MoneyDisplay amount={price} currency={currency} className="text-amount-s text-text-primary" />
        </div>
        <p className="font-display text-card text-text-primary">{title}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-body-s text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Calendar aria-hidden className="size-4 shrink-0" />
            {start}
          </span>
          {district ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden className="size-4 shrink-0" />
              {district}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-border-light pt-3">
          <span className="text-meta text-text-secondary">{posted}</span>
          {openLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-4 py-1.5 text-btn-sm text-text-primary transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
              {openLabel}
              <ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" />
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
