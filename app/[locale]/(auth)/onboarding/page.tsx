import { getTranslations, setRequestLocale } from 'next-intl/server';

import { OnboardingForm } from '@/components/features/auth/OnboardingForm';
import { PageHeader } from '@/components/shared/PageHeader';
import { getSessionUser } from '@/lib/auth/session';
import { Link, redirect } from '@/lib/i18n/navigation';
import { getPublicRegions } from '@/lib/region/public';

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
  const regions = await getPublicRegions();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-5 lg:px-8.5 lg:pt-6.5">
      <div className="flex max-w-220 flex-col gap-6">
        <Link href="/provider" dir="ltr" className="self-start font-wordmark text-wordmark text-text-primary">
          Aldebyani
        </Link>
        <PageHeader title={t('title')} intro={t('intro')} />
        <OnboardingForm
          preselect={as === 'provider' ? 'provider' : 'customer'}
          supportWhatsapp={regions[0]?.supportWhatsapp}
        />
      </div>
    </div>
  );
}
