'use client';

import { CirclePlus, LayoutDashboard, List, UserRound, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/lib/i18n/navigation';
import type { MenuItem } from '@/lib/navigation/menus';
import { cn } from '@/lib/utils';

const ICONS: Readonly<Record<MenuItem['key'], LucideIcon>> = {
  requests: List,
  newRequest: CirclePlus,
  dashboard: LayoutDashboard,
  profile: UserRound,
  account: UserRound,
};

/** Phones: fixed at the bottom, three tabs at most (ui-rules.md §13). */
export function BottomTabBar({ items }: { items: readonly MenuItem[] }) {
  const t = useTranslations('Nav');
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('tabs')}
      className="fixed inset-x-0 bottom-0 z-10 border-t-2 border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="flex">
        {items.map(({ key, href }) => {
          const Icon = ICONS[key];
          const active = pathname === href;
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
                <Icon aria-hidden className="size-5" />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
