'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/lib/i18n/navigation';
import { activeMenuKey, type MenuItem } from '@/lib/navigation/menus';
import { cn } from '@/lib/utils';

/**
 * The navy console rail from `lg` (`app-03`, ui-registry `AdminRail`, AC-13): built pages only, the active
 * one on a light pill, count badges for files under review, open flags (spec 0011-16) and open reports. No region switch, no console search.
 */
export function AdminRail({
  items,
  pending,
  reports = 0,
  flags = 0,
}: {
  items: readonly MenuItem[];
  pending: number;
  /** Spec 0011-14 AC-4: open reports. */
  reports?: number;
  /** Spec 0011-16 R-12: open deadline flags. */
  flags?: number;
}) {
  const t = useTranslations('Nav');
  const tAdmin = useTranslations('AdminReview');
  const tReports = useTranslations('AdminReports');
  const tFlags = useTranslations('AdminFlags');
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-8 bg-surface-inverse px-5 py-7 text-text-inverse lg:flex">
      <div className="flex items-center gap-2.5 px-3">
        <Link href="/admin" dir="ltr" className="font-wordmark text-wordmark-sm text-text-inverse">
          Aldebyani
        </Link>
        <span className="rounded-full bg-accent-light px-3 py-1 text-chip text-text-primary">
          {tAdmin('railBadge')}
        </span>
      </div>
      <nav aria-label={t('main')}>
        <ul className="flex flex-col gap-1.5">
          {items.map(({ key, href }) => {
            const active = key === activeMenuKey(items, pathname);
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-row px-4 py-3 text-nav',
                    active
                      ? 'bg-accent-light font-extrabold text-text-primary'
                      : 'text-text-inverse hover:bg-surface-inverse/80',
                  )}
                >
                  <span className="flex-1">{t(key)}</span>
                  {key === 'providers' && pending > 0 ? (
                    <span
                      className="flex min-w-7 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-chip text-text-primary"
                      aria-label={tAdmin('pendingCount', { count: pending })}
                    >
                      {pending}
                    </span>
                  ) : null}
                  {key === 'flags' && flags > 0 ? (
                    <span
                      className="flex min-w-7 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-chip text-text-primary"
                      aria-label={tFlags('openCount', { count: flags })}
                    >
                      {flags}
                    </span>
                  ) : null}
                  {key === 'reports' && reports > 0 ? (
                    <span
                      className="flex min-w-7 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-chip text-text-primary"
                      aria-label={tReports('openCount', { count: reports })}
                    >
                      {reports}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
