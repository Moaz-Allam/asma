import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { NavLinks } from '@/components/layout/NavLinks';
import { PublicMenu } from '@/components/layout/PublicMenu';
import { InitialAvatar } from '@/components/shared/InitialAvatar';
import { Button } from '@/components/ui/button';
import type { Role } from '@/lib/auth/roles';
import { Link } from '@/lib/i18n/navigation';
import { PUBLIC_ANCHORS, menuFor } from '@/lib/navigation/menus';
import { cn } from '@/lib/utils';

/**
 * The header (ui-rules.md §14). The role menu lists only pages that exist, and there is no bell before
 * position 18. Signed out it shows the landing anchors and the sign in pills. The anchors fit in the row from
 * `xl`, the other two pills from `lg`; below that `PublicMenu` stacks them.
 */
export async function SiteHeader({
  user,
  badge,
  railFromLg = false,
}: {
  user?: { role: Role; name: string } | null;
  badge?: ReactNode;
  /** Admin: from `lg` the navy rail holds the menu, so the header shows none there (spec 0006 AC-13). */
  railFromLg?: boolean;
}) {
  const t = await getTranslations('Nav');
  const tLanding = await getTranslations('Landing');

  return (
    <header
      className={cn(
        'mx-auto flex w-full max-w-7xl items-center gap-4 px-5 pt-5 pb-5 lg:px-8.5',
        user ? 'lg:gap-7.5 lg:pt-6.5 lg:pb-5.5' : 'lg:gap-8.5 lg:py-6.5',
      )}
    >
      <Link
        href="/"
        dir="ltr"
        aria-label={t('home')}
        className={cn(
          'font-wordmark text-wordmark-sm text-text-primary',
          user ? 'lg:text-wordmark' : 'lg:text-wordmark-lg',
        )}
      >
        Aldebyani
      </Link>

      {user ? (
        <>
          <div className="flex-1">{railFromLg ? null : <NavLinks items={menuFor(user.role)} />}</div>
          {badge}
          <Link href="/account" aria-label={t('account')}>
            <InitialAvatar name={user.name} className="text-label font-extrabold" />
          </Link>
        </>
      ) : (
        <>
          <nav aria-label={t('main')} className="hidden flex-1 items-center gap-6.5 xl:flex">
            {PUBLIC_ANCHORS.map(({ key, hash }) => (
              <Link
                key={key}
                href={{ pathname: '/', hash }}
                className="text-nav text-text-primary hover:text-link"
              >
                {t(key)}
              </Link>
            ))}
          </nav>
          <div className="flex flex-1 items-center justify-end gap-2 lg:gap-3.5 xl:flex-none">
            <Button asChild variant="secondary" size="nav">
              <Link href="/login">{t('signIn')}</Link>
            </Button>
            <Button asChild variant="secondary" size="nav" className="hidden lg:inline-flex">
              <Link href={{ pathname: '/login', query: { as: 'provider' } }}>{tLanding('ctaProvider')}</Link>
            </Button>
            <Button asChild size="nav" className="hidden lg:inline-flex">
              <Link href={{ pathname: '/login', query: { next: '/requests/new' } }}>{tLanding('cta')}</Link>
            </Button>
            <PublicMenu />
          </div>
        </>
      )}
    </header>
  );
}
