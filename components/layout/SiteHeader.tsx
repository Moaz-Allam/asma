import { getTranslations } from 'next-intl/server';

import { NavLinks } from '@/components/layout/NavLinks';
import { InitialAvatar } from '@/components/shared/InitialAvatar';
import { Button } from '@/components/ui/button';
import type { Role } from '@/lib/auth/roles';
import { Link } from '@/lib/i18n/navigation';
import { menuFor } from '@/lib/navigation/menus';

/**
 * The header (ui-rules.md §14). The role menu lists only pages that exist, and there is no bell before
 * position 18. Signed out it shows the sign in pills; the phone keeps the one that fits.
 */
export async function SiteHeader({ user }: { user?: { role: Role; name: string } | null }) {
  const t = await getTranslations('Nav');
  const tLanding = await getTranslations('Landing');

  return (
    <header className="sticky top-0 z-10 border-b-2 border-border-light bg-background">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 lg:px-8.5">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            aria-label={t('home')}
            className="font-wordmark text-wordmark-sm text-text-primary lg:text-wordmark"
          >
            Aldebyani
          </Link>
          {user ? <NavLinks items={menuFor(user.role)} /> : null}
        </div>

        {user ? (
          <Link href="/account" aria-label={t('account')}>
            <InitialAvatar name={user.name} />
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary">
              <Link href="/login">{t('signIn')}</Link>
            </Button>
            <Button asChild variant="secondary" className="hidden lg:inline-flex">
              <Link href={{ pathname: '/login', query: { as: 'provider' } }}>{tLanding('ctaProvider')}</Link>
            </Button>
            <Button asChild className="hidden lg:inline-flex">
              <Link href={{ pathname: '/login', query: { next: '/requests/new' } }}>{tLanding('cta')}</Link>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
