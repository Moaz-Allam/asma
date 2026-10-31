import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';

type Props = { params: Promise<{ locale: string }> };

/** The first stop of a new customer. `EmptyState` until position 04. */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['customer']);
  const t = await getTranslations('Homes');

  return (
    <>
      <PageHeader title={t('newRequestTitle')} />
      <EmptyState lead={t('newRequestLead')} title={t('newRequestEmpty')} body={t('newRequestBody')} />
    </>
  );
}
