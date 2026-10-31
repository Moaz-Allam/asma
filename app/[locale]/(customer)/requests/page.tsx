import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';

type Props = { params: Promise<{ locale: string }> };

/** The customer home. `EmptyState` until position 04. */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['customer']);
  const t = await getTranslations('Homes');

  return (
    <>
      <PageHeader title={t('requestsTitle')} />
      <EmptyState lead={t('requestsLead')} title={t('requestsEmpty')} body={t('requestsBody')} />
    </>
  );
}
