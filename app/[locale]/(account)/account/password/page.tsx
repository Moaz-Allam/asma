import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SetPasswordForm } from '@/components/features/account/SetPasswordForm';
import { PageHeader } from '@/components/shared/PageHeader';
import { getProfile } from '@/lib/account/profile';
import { landingFor } from '@/lib/auth/roles';
import { guardPage } from '@/lib/auth/session';
import { redirect } from '@/lib/i18n/navigation';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string; next?: string }>;
};

/**
 * The password step (spec 0012 AC-4, AC-5, AC-6), for any role: a first password after a code sign in, or a reset
 * one with `reason=reset`. With a password already set and no reason it sends to `/account`. `reason` only changes
 * the words and the event; Auth decides what is allowed (Secure password change).
 */
export default async function PasswordPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage('any');
  const { reason, next } = await searchParams;
  const resetting = reason === 'reset';
  if (user.hasPassword && !resetting) return redirect({ href: '/account', locale });

  const profile = await getProfile(user.id);
  const t = await getTranslations('Account.password');
  const kind = resetting && user.hasPassword ? 'reset' : 'first';

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader
        title={kind === 'reset' ? t('resetTitle') : t('firstTitle')}
        intro={kind === 'reset' ? t('resetIntro') : t('firstIntro')}
      />
      <section className="rounded-card border-2 border-border bg-surface px-6 py-5">
        <SetPasswordForm phone={profile?.phone ?? null} reason={kind} next={landingFor(user.role, next)} />
      </section>
    </div>
  );
}
