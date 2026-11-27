'use client';

import {
  AlarmClock,
  Calculator,
  ChartColumn,
  CirclePlus,
  FileText,
  Flag,
  History,
  LayoutDashboard,
  LayoutList,
  List,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/lib/i18n/navigation';
import { activeMenuKey, type MenuItem } from '@/lib/navigation/menus';
import { cn } from '@/lib/utils';

const RAIL_ICONS: Readonly<Record<MenuItem['key'], LucideIcon>> = {
  requests: List,
  newRequest: CirclePlus,
  dashboard: LayoutDashboard,
  profile: UserRound,
  account: UserRound,
  publicAccount: UserRound,
  providers: UsersRound,
  catalog: LayoutList,
  pricing: Calculator,
  feed: Search,
  applications: Send,
  setup: SlidersHorizontal,
  reports: Flag,
  flags: AlarmClock,
  revenue: ChartColumn,
  quality: ShieldCheck,
  agreements: FileText,
  history: History,
};

/**
 * The navy console rail from `lg` (`app-03`, ui-registry `AdminRail`, AC-13): built pages only, the active
 * one on a light pill, count badges for files under review, open flags (spec 0011-16) and open reports. No region switch, no console search.
 */
export function AdminRail({
  items,
  pending,
  reports = 0,
  flags = 0,
  note,
}: {
  items: readonly MenuItem[];
  pending: number;
  /** Spec 0011-14 AC-4: open reports. */
  reports?: number;
  /** Spec 0011-16 R-12: open deadline flags. */
  flags?: number;
  /** Ledger integrity note at the foot of the rail (`app-01`). */
  note?: string;
}) {
  const t = useTranslations('Nav');
  const tAdmin = useTranslations('AdminReview');
  const tReports = useTranslations('AdminReports');
  const tFlags = useTranslations('AdminFlags');
  const pathname = usePathname();
  const activeKey = activeMenuKey(items, pathname);

  return (
    <aside className="hidden w-68 shrink-0 flex-col gap-8 bg-surface-inverse px-5 py-7 text-text-inverse lg:flex">
      <div className="flex items-center gap-2.5 px-3">
        <Link href="/admin" dir="ltr" className="font-wordmark text-wordmark-sm text-text-inverse">
          Aldebyani
        </Link>
        <span className="rounded-full bg-accent-light px-3 py-1 text-chip text-text-primary">
          {tAdmin('railBadge')}
        </span>
      </div>
      <nav aria-label={t('main')} className="flex-1">
        <ul className="flex flex-col gap-1.5">
          {items.map(({ key, href }) => {
            const active = key === activeKey;
            const Icon = RAIL_ICONS[key];
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-row px-4 py-3 text-nav transition-colors',
                    active
                      ? 'bg-accent-light font-extrabold text-text-primary'
                      : 'text-text-inverse hover:bg-surface/10',
                  )}
                >
                  <Icon aria-hidden className="size-4.5 shrink-0 opacity-85" />
                  <span className="flex-1">{t(key)}</span>
                  {key === 'providers' && pending > 0 ? (
                    <span
                      className="flex min-w-7 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-chip tabular-nums text-text-primary"
                      aria-label={tAdmin('pendingCount', { count: pending })}
                    >
                      {pending}
                    </span>
                  ) : null}
                  {key === 'flags' && flags > 0 ? (
                    <span
                      className="flex min-w-7 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-chip tabular-nums text-text-primary"
                      aria-label={tFlags('openCount', { count: flags })}
                    >
                      {flags}
                    </span>
                  ) : null}
                  {key === 'reports' && reports > 0 ? (
                    <span
                      className="flex min-w-7 items-center justify-center rounded-full bg-surface px-2 py-0.5 text-chip tabular-nums text-text-primary"
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
      {note ? <p className="rounded-row bg-surface/10 p-4 text-meta text-accent-light">{note}</p> : null}
    </aside>
  );
}
