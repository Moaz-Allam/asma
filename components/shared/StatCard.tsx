import type { ReactNode } from 'react';

import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

export type StatTone = 'emphasis' | 'tinted' | 'white' | 'inverse';

const TONES: Readonly<Record<StatTone, string>> = {
  emphasis: 'bg-accent-light text-text-primary',
  tinted: 'bg-surface-secondary text-text-primary',
  white: 'border-2 border-border bg-surface text-text-primary',
  inverse: 'bg-surface-inverse text-text-inverse',
};

/**
 * KPI stat card (`ui-registry.md` `StatCard`, `app-01`, `p6`, `s10`): eyebrow label, optional icon,
 * tabular display value (or `MoneyDisplay`), and a supporting context line. No shadows or gradients.
 */
export function StatCard({
  label,
  value,
  note,
  icon,
  tone = 'tinted',
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  href?: string;
  className?: string;
}) {
  const muted = tone === 'inverse' ? 'text-accent-light' : 'text-text-secondary';
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-eyebrow uppercase', muted)}>{label}</span>
        {icon ? <span className={cn('shrink-0', muted)}>{icon}</span> : null}
      </div>
      <div className="font-display text-amount-s tabular-nums sm:text-amount">{value}</div>
      {note ? <p className={cn('text-meta', muted)}>{note}</p> : null}
    </>
  );

  const shared = cn('flex flex-col gap-2 rounded-panel p-5.5 lg:p-6.5', TONES[tone], className);

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          shared,
          'transition duration-150 ease-out hover:-translate-y-px hover:ring-2 hover:ring-accent focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={shared}>{body}</div>;
}
