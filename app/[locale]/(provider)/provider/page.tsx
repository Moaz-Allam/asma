import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AccountStateBanner } from '@/components/features/provider/AccountStateBanner';
import { FileProgress } from '@/components/features/provider/FileProgress';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { getProviderFile, getStanding } from '@/lib/provider/queries';

type Props = { params: Promise<{ locale: string }> };

/** The provider home follows `provider_standing()` (spec 0006 AC-10). A null standing is an error, never draft. */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await guardPage(['provider']);
  const t = await getTranslations('Provider.home');
  const tHomes = await getTranslations('Homes');

  const [standing, file] = await Promise.all([getStanding(user.id), getProviderFile(user.id)]);

  if (!standing || !file) {
    return (
      <>
        <PageHeader title={tHomes('providerTitle')} />
        <ErrorState title={t('error.title')} body={t('error.body')} />
      </>
    );
  }

  if (standing === 'draft') {
    return (
      <>
        <PageHeader title={t('draft.title')} intro={t('draft.body')} />
        <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
          <section className="flex flex-col items-start gap-4 rounded-panel bg-accent-light p-6.5 lg:p-9">
            <p className="text-body text-text-primary">{t('draft.next')}</p>
            <Button asChild size="lg">
              <Link href="/provider/profile">{t('draft.action')}</Link>
            </Button>
          </section>
          <FileProgress file={file} />
        </div>
      </>
    );
  }

  if (standing === 'approved') {
    return (
      <>
        <PageHeader title={tHomes('providerTitle')} />
        <EmptyState
          lead={tHomes('providerLead')}
          title={tHomes('providerEmpty')}
          body={tHomes('providerBody')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={tHomes('providerTitle')} />
      <AccountStateBanner standing={standing} file={file} />
    </>
  );
}
