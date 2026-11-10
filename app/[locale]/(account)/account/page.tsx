import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccountForm } from '@/components/features/account/AccountForm';
import { NotificationTable } from '@/components/features/account/NotificationTable';
import { SignOutCard } from '@/components/features/account/SignOutCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { getProfile } from '@/lib/account/profile';
import { guardPage } from '@/lib/auth/session';
import { Link, redirect } from '@/lib/i18n/navigation';
import { getTurnedOffTopics } from '@/lib/notifications/preferences';
import { noticeRowsFor } from '@/lib/notifications/topics';

type Props = { params: Promise<{ locale: string }> };

/** `s12`, `p16`, for every role (spec 0005 AC-19, AC-32). No activity tiles before positions 04 and 12. */
export default async function AccountPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage('any');
  const profile = await getProfile(user.id);
  if (!profile) return redirect({ href: '/onboarding', locale });
  const turnedOff = await getTurnedOffTopics(user.id);
  const t = await getTranslations('Account');

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-account">
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader title={t('title')} intro={t('intro')} />
        <AccountForm
          fullName={profile.fullName}
          phone={profile.phone}
          email={profile.email}
          emailConfirmed={profile.emailConfirmed}
        >
          <NotificationTable rows={noticeRowsFor(user.role)} turnedOff={turnedOff} />
        </AccountForm>
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        {user.role === 'provider' ? (
          <section className="flex items-center justify-between gap-4 rounded-card bg-surface-secondary px-6 py-5">
            <p className="text-label text-text-primary">{t('providerLinkTitle')}</p>
            <Button asChild variant="white">
              <Link href="/provider/profile">{t('providerLink')}</Link>
            </Button>
          </section>
        ) : null}
        <SignOutCard />
      </div>
    </div>
  );
}
