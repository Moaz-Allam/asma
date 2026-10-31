'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/lib/i18n/navigation';
import type { MenuItem } from '@/lib/navigation/menus';
import { cn } from '@/lib/utils';

/** The active item is shown with `aria-current` and weight, no underline (ui-rules.md §14). */
export function NavLinks({ items }: { items: readonly MenuItem[] }) {
  const t = useTranslations('Nav');
  const pathname = usePathname();

  return (
    <nav aria-label={t('main')} className="hidden items-center gap-6 lg:flex">
      {items.map(({ key, href }) => (
        <Link
          key={key}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
          className={cn('text-nav text-text-primary', pathname === href && 'font-extrabold')}
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
