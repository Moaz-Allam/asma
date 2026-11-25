'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/lib/i18n/navigation';
import { activeMenuKey, menuLabelKey, type MenuItem } from '@/lib/navigation/menus';
import { cn } from '@/lib/utils';

/** The active item is shown with `aria-current`, pill tint and weight, no underline (ui-rules.md §14). */
export function NavLinks({ items }: { items: readonly MenuItem[] }) {
  const t = useTranslations('Nav');
  const label = useTranslations();
  const pathname = usePathname();
  const currentKey = activeMenuKey(items, pathname);

  return (
    <nav aria-label={t('main')} className="hidden items-center gap-2 lg:flex">
      {items.map(({ key, href }) => {
        const active = key === currentKey;
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-4 py-2 text-nav transition-colors',
              active
                ? 'bg-surface-secondary font-extrabold text-text-primary'
                : 'text-text-primary hover:bg-surface-secondary/70 hover:text-link',
            )}
          >
            {label(menuLabelKey(key))}
          </Link>
        );
      })}
    </nav>
  );
}
