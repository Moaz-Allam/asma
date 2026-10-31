import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';

type Props = { params: Promise<{ locale: string }> };

/** The admin home. `EmptyState` until position 16. */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const t = await getTranslations('Homes');

  return (
    <>
      <PageHeader title={t('adminTitle')} />
      <EmptyState lead={t('adminLead')} title={t('adminEmpty')} body={t('adminBody')} />
    </>
  );
}
