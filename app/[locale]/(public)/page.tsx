import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { Button } from '@/components/ui/button';
import { getSessionUser } from '@/lib/auth/session';
import { Link, redirect } from '@/lib/i18n/navigation';

type Props = { params: Promise<{ locale: string }> };

/** A small landing in part 1 of spec 0005; the full `s1` comes in part 2. Signed in goes home. */
export default async function LandingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await getSessionUser()) redirect({ href: '/continue', locale });

  const t = await getTranslations('Landing');

  return (
    <>
      <section className="flex flex-col gap-4 rounded-panel bg-surface-inverse px-6.5 py-8 text-text-inverse">
        <p className="text-eyebrow">{t('title')}</p>
        <h1 className="font-display text-title">{t('heading')}</h1>
        <p className="text-body-l">{t('body')}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="white" size="lg">
            <Link href={{ pathname: '/login', query: { next: '/requests/new' } }}>{t('cta')}</Link>
          </Button>
          <Button asChild variant="white" size="lg">
            <Link href={{ pathname: '/login', query: { as: 'provider' } }}>{t('ctaProvider')}</Link>
          </Button>
        </div>
      </section>
      <LocaleSwitcher />
    </>
  );
}
