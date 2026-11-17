import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * One request in the provider's feed (ui-registry `FeedCard`, `p10`, spec 0009 AC-6): the service, the district,
 * the start in the region's time zone, the job price, "n of m offers", a "You applied" chip, and "Details and
 * apply". A full request stays in the list, greyed, with "Reached the limit" and no button. Nothing else: no
 * customer, address, notes or typed answer ever reaches it. Display only; the page passes every string.
 */
export function FeedCard({
  href,
  title,
  where,
  price,
  currency,
  offers,
  appliedLabel,
  full,
  fullLabel,
  actionLabel,
}: {
  href: string;
  title: string;
  where: string;
  price: number;
  currency: 'TRY' | 'SAR';
  offers: string;
  appliedLabel: string | null;
  full: boolean;
  fullLabel: string;
  actionLabel: string;
}) {
  return (
    <li
      className={cn(
        'flex flex-col gap-4 rounded-panel border-2 border-border-light bg-surface p-5 sm:flex-row sm:items-center sm:justify-between lg:p-6',
        full && 'opacity-60',
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          {appliedLabel ? <StatusChip tone="waiting" label={appliedLabel} /> : null}
          <span className="text-meta text-text-secondary">{offers}</span>
        </div>
        <p className="font-display text-card break-words text-text-primary">{title}</p>
        <p className="text-body-s text-text-secondary">{where}</p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
        <MoneyDisplay amount={price} currency={currency} className="text-amount-s text-text-primary" />
        {full && !appliedLabel ? (
          <p className="text-meta text-text-secondary">{fullLabel}</p>
        ) : (
          <Button asChild size="md">
            <Link href={href}>{actionLabel}</Link>
          </Button>
        )}
      </div>
    </li>
  );
}
