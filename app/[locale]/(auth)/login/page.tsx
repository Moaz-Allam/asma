import { DoorClosed } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';

import { LoginForm } from '@/components/features/auth/LoginForm';
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
    <div className="grid gap-3.5 lg:grid-cols-2">
      <section className="flex flex-col gap-5 rounded-panel bg-accent-light px-6.5 py-8">
        <Link href="/" className="font-wordmark text-wordmark text-text-primary">
          Aldebyani
        </Link>
        {regions.length > 0 ? (
          <LoginForm
            dialCodes={regions.map((region) => region.dialCode)}
            siteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
            nonce={nonce}
            next={safe}
            asProvider={asProvider}
          />
        ) : (
          <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
            {t('noRegion')}
          </p>
        )}
        <LocaleSwitcher />
      </section>
      <div
        aria-hidden
        className="hidden items-center justify-center rounded-panel bg-surface-secondary lg:flex"
      >
        <span className="flex size-56 items-center justify-center rounded-full bg-accent-muted text-text-primary">
          <DoorClosed className="size-28" strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}
