import { getTranslations, setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';

import { LoginForm } from '@/components/features/auth/LoginForm';
import { PasswordLoginForm } from '@/components/features/auth/PasswordLoginForm';
import { LandingPhoto } from '@/components/features/landing/LandingPhoto';
import { safeNext } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/auth/session';
import { getEnv } from '@/lib/env';
import { Link, redirect } from '@/lib/i18n/navigation';
import { getPublicRegions } from '@/lib/region/public';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; as?: string; mode?: string; reset?: string }>;
};

/**
 * `s2`. `next` is checked here, and again at `/continue`; `as` only ever means provider (AC-7).
 * Spec 0012 AC-1, AC-3: phone and password by default (an unknown `mode` too); `?mode=code` is 0005's code flow, for
 * a new account and, with `reset=1`, a password reset. A signed in visitor goes on to `/continue`, except on a reset:
 * the code form signs this device out first.
 */
export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next, as, mode, reset: resetParam } = await searchParams;
  const safe = safeNext(next);
  const asProvider = as === 'provider';
  const reset = resetParam === '1';
  const codeMode = mode === 'code' || reset;
  const signedIn = (await getSessionUser()) !== null;

  if (signedIn && !reset) {
    const query = { ...(safe ? { next: safe } : {}), ...(asProvider ? { as: 'provider' } : {}) };
    redirect({ href: { pathname: '/continue', query }, locale });
  }

  const t = await getTranslations('Login');
  const regions = await getPublicRegions();
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <div className="grid min-h-dvh grid-cols-1 gap-3 p-3 lg:grid-cols-2 lg:gap-4 lg:p-4">
      {/* The form box: the wordmark at the top, the card centred in the rest. */}
      <section className="flex min-h-[calc(100dvh-1.5rem)] flex-col rounded-card bg-accent-light px-5 py-6 lg:min-h-[calc(100dvh-2rem)] lg:px-10 lg:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            dir="ltr"
            className="inline-flex min-h-11 items-center font-wordmark text-wordmark-sm text-text-primary"
          >
            Aldebyani
          </Link>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6">
          <div className="flex max-w-2xl flex-col items-center gap-2 text-center">
            <p className="font-display text-title-s text-text-primary lg:text-title">{t('hero.title')}</p>
            <p className="text-body text-text-lede">{t('hero.subtitle')}</p>
          </div>
          {/* Compact here only, as the reference: 50px fields and button, a smaller card heading. */}
          <div className="flex w-full max-w-md flex-col gap-4 rounded-card border-2 border-border bg-surface p-6 sm:p-7 [&_[type=submit]]:py-3.5 [&_[type=submit]]:text-btn-sm [&_form]:gap-3.5 [&_h1]:text-section [&_input]:h-12.5 [&_input]:py-2.5">
            {regions.length > 0 && codeMode ? (
              <LoginForm
                dialCodes={regions.map((region) => region.dialCode)}
                siteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                nonce={nonce}
                next={safe}
                asProvider={asProvider}
                supportWhatsapp={regions[0]?.supportWhatsapp}
                reset={reset}
                signOutFirst={signedIn}
              />
            ) : regions.length > 0 ? (
              <PasswordLoginForm
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
          </div>
        </div>
      </section>
      {/* The photo box, from lg: fills its half, edge to edge. */}
      <LandingPhoto
        slot="login-cleaner"
        focus="58% 40%"
        sizes="50vw"
        priority
        className="hidden rounded-card lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-2rem)]"
      />
    </div>
  );
}
