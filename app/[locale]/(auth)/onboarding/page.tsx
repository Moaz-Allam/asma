import { getTranslations, setRequestLocale } from 'next-intl/server';

import { OnboardingForm } from '@/components/features/auth/OnboardingForm';
import { PageHeader } from '@/components/shared/PageHeader';
import { getSessionUser } from '@/lib/auth/session';
import { redirect } from '@/lib/i18n/navigation';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ as?: string }>;
};

/** `s11`, for a signed in user with no role. Everyone else has somewhere better to be (AC-7). */
export default async function OnboardingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getSessionUser();
  if (!user) redirect({ href: '/login', locale });
  if (user?.role) redirect({ href: '/continue', locale });

  const t = await getTranslations('Onboarding');
  const { as } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} intro={t('intro')} />
      <OnboardingForm preselect={as === 'provider' ? 'provider' : 'customer'} />
    </div>
  );
}
