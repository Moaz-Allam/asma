import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';

type Props = { params: Promise<{ locale: string }> };

/** The provider home. `EmptyState` until position 02. */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['provider']);
  const t = await getTranslations('Homes');

  return (
    <>
      <PageHeader title={t('providerTitle')} />
      <EmptyState lead={t('providerLead')} title={t('providerEmpty')} body={t('providerBody')} />
    </>
  );
}
