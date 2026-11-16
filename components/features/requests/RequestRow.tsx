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
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-3 rounded-panel border border-border-light bg-surface p-5 transition hover:border-accent focus-visible:ring-2 focus-visible:ring-ring lg:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusChip tone={toneOf(status)} label={statusLabel} />
          <MoneyDisplay amount={price} currency={currency} className="text-amount-s text-text-primary" />
        </div>
        <p className="font-display text-card text-text-primary">{title}</p>
        <p className="text-body-s text-text-secondary">
          {start} · {district}
        </p>
        <p className="text-meta text-text-secondary">{posted}</p>
      </Link>
    </li>
  );
}
