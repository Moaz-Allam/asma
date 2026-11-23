import { getTranslations, setRequestLocale } from 'next-intl/server';

import { FileProgress } from '@/components/features/provider/FileProgress';
import { OnboardingFrame } from '@/components/features/provider/OnboardingFrame';
import { ProviderAddressForm } from '@/components/features/provider/ProviderAddressForm';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { PROVIDER_ADDRESS_KEYS, type AddressDraft } from '@/lib/address/parts';
import { guardPage } from '@/lib/auth/session';
import { mapKey } from '@/lib/maps/key';
import { myAddressInDb } from '@/lib/provider/db';
import { getProviderFile, getStanding } from '@/lib/provider/queries';

type Props = { params: Promise<{ locale: string }> };

/**
 * The provider's address (spec 0011-20b AC-5, X-13): step 2 of onboarding for a draft or rejected file, then the
 * documents; for everyone else the same form, back to the profile. Any standing may change it; an agreement already
 * made keeps its frozen copy (AC-8).
 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const t = await getTranslations('Address.provider');
  const tHome = await getTranslations('Provider.home');

  const [standing, file, saved] = await Promise.all([
    getStanding(user.id),
    getProviderFile(user.id),
    myAddressInDb(),
  ]);
  if (!standing || !file) {
    return (
      <>
        <PageHeader title={t('title')} />
        <ErrorState title={tHome('error.title')} body={tHome('error.body')} />
      </>
    );
  }

  const initial: AddressDraft = {};
  for (const key of PROVIDER_ADDRESS_KEYS) {
    const value = saved?.[key];
    if (typeof value === 'string') initial[key] = value;
  }
  if (typeof saved?.lat === 'number' && typeof saved?.lng === 'number') {
    initial.lat = saved.lat;
    initial.lng = saved.lng;
  }

  const onboarding = standing === 'draft' || standing === 'rejected';
  const form = (
    <ProviderAddressForm
      initial={initial}
      mapKey={mapKey()}
      afterSave={onboarding ? '/provider/profile/documents' : '/provider/profile'}
    />
  );

  if (!onboarding) {
    return (
      <>
        <PageHeader title={t('title')} intro={t('intro')} />
        {form}
      </>
    );
  }

  return (
    <OnboardingFrame step={2} title={t('title')} intro={t('intro')} aside={<FileProgress file={file} />}>
      {form}
    </OnboardingFrame>
  );
}
