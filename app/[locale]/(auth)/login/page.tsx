import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';

import { LoginForm } from '@/components/features/auth/LoginForm';
import { LandingPhoto } from '@/components/features/landing/LandingPhoto';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { safeNext } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/auth/session';
import { getEnv } from '@/lib/env';
import { Link, redirect } from '@/lib/i18n/navigation';
import { getPublicRegions } from '@/lib/region/public';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; as?: string }>;
};

/** `s2`. `next` is checked here, and again at `/continue`; `as` only ever means provider (AC-7). */
export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next, as } = await searchParams;
  const safe = safeNext(next);
  const asProvider = as === 'provider';

  if (await getSessionUser()) {
    const query = { ...(safe ? { next: safe } : {}), ...(asProvider ? { as: 'provider' } : {}) };
    redirect({ href: { pathname: '/continue', query }, locale });
  }

  const t = await getTranslations('Login');
  const regions = await getPublicRegions();
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-login">
      <LandingPhoto slot="hallway" sizes="40vw" className="hidden rounded-card lg:block" />
      <section className="flex min-h-120 flex-col gap-4 rounded-card bg-accent-light px-6.5 py-8 lg:px-7.5">
        <Link href="/" dir="ltr" className="font-wordmark text-wordmark-sm text-text-primary">
          Aldebyani
        </Link>
        {regions.length > 0 ? (
          <LoginForm
            dialCodes={regions.map((region) => region.dialCode)}
            siteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
            nonce={nonce}
            next={safe}
            asProvider={asProvider}
            supportWhatsapp={regions[0]?.supportWhatsapp}
          />
        ) : (
          <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
            {t('noRegion')}
          </p>
        )}
        <LocaleSwitcher />
      </section>
    </div>
  );
}
