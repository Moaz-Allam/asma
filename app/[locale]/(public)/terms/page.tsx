import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
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
    <div className="flex flex-col gap-6 pt-4 pb-8 lg:pt-6.5">
      <PageHeader title={t('termsTitle')} />
      <article className="flex max-w-4xl flex-col gap-5 rounded-panel border-2 border-border bg-surface-secondary p-6.5 lg:p-9">
        <p className="max-w-60ch text-body leading-relaxed text-text-primary">{t('termsBody')}</p>
        <div className="pt-2">
          <Button asChild variant="white">
            <Link href="/">{t('backHome')}</Link>
          </Button>
        </div>
      </article>
    </div>
  );
}
