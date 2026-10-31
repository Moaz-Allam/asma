import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccountForm } from '@/components/features/account/AccountForm';
import { SignOutCard } from '@/components/features/account/SignOutCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { getProfile } from '@/lib/account/profile';
import { guardPage } from '@/lib/auth/session';
import { redirect } from '@/lib/i18n/navigation';

type Props = { params: Promise<{ locale: string }> };

/** `s12`, `p16`, for every role. Email and the notification table come in part 2 of spec 0005. */
export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage('any');
  const profile = await getProfile(user.id);
  if (!profile) return redirect({ href: '/onboarding', locale });
  const t = await getTranslations('Account');

  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AccountForm fullName={profile.fullName} phone={profile.phone} />
        </div>
        <SignOutCard />
      </div>
    </>
  );
}
