import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ProviderQueue } from '@/components/features/admin/ProviderQueue';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';
import { parseQueueQuery } from '@/lib/provider/admin-queries';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The provider queue (`app-03`, AC-14). An invalid query falls back silently to pending, oldest, page 1. */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const t = await getTranslations('Admin.queue');
  const query = parseQueueQuery(await searchParams);

  return (
    <>
      <PageHeader title={t('title')} intro={t('intro')} />
      <div className="max-w-2xl">
        <ProviderQueue query={query} />
      </div>
    </>
  );
}
