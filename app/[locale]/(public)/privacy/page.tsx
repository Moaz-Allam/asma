import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageHeader } from '@/components/shared/PageHeader';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

type Props = { params: Promise<{ locale: string }> };

/** A draft until S16 (D100). The launch gate fails while the `[draft]` marker remains. */
export const metadata = PRIVATE_PAGE_METADATA;

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Legal');

  return (
    <>
      <PageHeader title={t('privacyTitle')} />
      <p className="max-w-3xl text-body text-text-secondary">{t('privacyBody')}</p>
    </>
  );
}
