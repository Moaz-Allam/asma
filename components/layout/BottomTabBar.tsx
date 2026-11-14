'use client';

import { CirclePlus, LayoutDashboard, List, UserRound, UsersRound, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/lib/i18n/navigation';
import { activeMenuKey, type MenuItem } from '@/lib/navigation/menus';
import { cn } from '@/lib/utils';

const ICONS: Readonly<Record<MenuItem['key'], LucideIcon>> = {
  requests: List,
  newRequest: CirclePlus,
  dashboard: LayoutDashboard,
  profile: UserRound,
  account: UserRound,
  providers: UsersRound,
};

/**
 * Phones: fixed at the bottom, three tabs at most (ui-rules.md §13). `counts` puts a badge on a tab, as the
 * admin rail does for files under review (spec 0006 AC-13).
 */
export function BottomTabBar({
  items,
  counts = {},
}: {
  items: readonly MenuItem[];
  counts?: Partial<Record<MenuItem['key'], number>>;
}) {
  const t = useTranslations('Nav');
  const tAdmin = useTranslations('AdminReview');
  const pathname = usePathname();
  const activeKey = activeMenuKey(items, pathname);

  return (
    <nav
      aria-label={t('tabs')}
      className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {items.map(({ key, href }) => {
          const Icon = ICONS[key];
          const active = key === activeKey;
          return (
            <li key={key} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 text-meta text-text-secondary',
                  active && 'font-bold text-text-primary',
                )}
              >
                <span className="relative">
                  <Icon aria-hidden className="size-5" />
                  {key === 'providers' && (counts[key] ?? 0) > 0 ? (
                    <span
                      className="absolute -end-3 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-surface-inverse px-1.5 text-chip text-text-inverse"
                      aria-label={tAdmin('pendingCount', { count: counts[key] ?? 0 })}
                    >
                      {counts[key]}
                    </span>
                  ) : null}
                </span>
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
