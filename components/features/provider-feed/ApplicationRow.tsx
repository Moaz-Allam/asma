import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { StatusChip } from '@/components/shared/StatusChip';
import { Link } from '@/lib/i18n/navigation';
import { applicationTone, type ApplicationStatus } from '@/lib/provider-feed/constants';

/**
 * One of the provider's applications (ui-registry `ApplicationRow`, spec 0009 AC-13): the status chip, the
 * service, the district and start, the job price, and a link to the request's short details. Display only.
 */
export function ApplicationRow({
  href,
  status,
  statusLabel,
  title,
  where,
  applied,
  note = null,
  price,
  currency,
}: {
  href: string;
  status: ApplicationStatus;
  statusLabel: string;
  title: string;
  where: string;
  applied: string;
  /** Spec 0010 AC-12: the chosen, not chosen or cancelled line. */
  note?: string | null;
  price: number;
  currency: 'TRY' | 'SAR';
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-3 rounded-panel border-2 border-border bg-surface p-5 transition hover:border-accent focus-visible:ring-2 focus-visible:ring-ring lg:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusChip tone={applicationTone(status)} label={statusLabel} />
          <MoneyDisplay amount={price} currency={currency} className="text-amount-s text-text-primary" />
        </div>
        <p className="font-display text-card break-words text-text-primary">{title}</p>
        <p className="text-body-s text-text-secondary">{where}</p>
        {note ? <p className="text-body-s font-semibold text-text-primary">{note}</p> : null}
        <p className="text-meta text-text-secondary">{applied}</p>
      </Link>
    </li>
  );
}
