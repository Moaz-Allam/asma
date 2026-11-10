import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageHeader } from '@/components/shared/PageHeader';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';
import { legalPageIsFinal } from '@/lib/seo/site';

type Props = { params: Promise<{ locale: string }> };

/** A draft until S16 (D100). The launch gate fails while the `[draft]` marker remains. */
export const metadata = legalPageIsFinal('terms') ? {} : PRIVATE_PAGE_METADATA;

export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Legal');

  return (
    <div className="flex flex-col gap-7.5 pt-6.5">
      <PageHeader title={t('termsTitle')} />
      <p className="max-w-3xl text-body text-text-secondary">{t('termsBody')}</p>
    </div>
  );
}
