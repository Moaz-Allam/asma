import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ProviderSetupForm } from '@/components/features/provider-feed/ProviderSetupForm';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';
import { getStanding } from '@/lib/provider/queries';
import { loadSetup } from '@/lib/provider-feed';

type Props = { params: Promise<{ locale: string }> };

/**
 * `p4`, services, districts and work days (spec 0009 AC-2 to AC-4, D151). Any standing edits; a suspended
 * provider reads only. A save never sends the file back to review.
 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const t = await getTranslations('ProviderFeed.setup');

  const [standing, result] = await Promise.all([getStanding(user.id), loadSetup({ region: user.region })]);

  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      {result.ok ? (
        <ProviderSetupForm setup={result.setup} readOnly={standing === 'suspended'} />
      ) : (
        <ErrorState title={t('error.title')} body={t('error.body')} />
      )}
    </>
  );
}
