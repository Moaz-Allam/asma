import { getTranslations } from 'next-intl/server';

import { PageSkeleton } from '@/components/shared/PageSkeleton';

/** Loading state for this page (spec 0007 AC-23). */
export default async function Loading() {
  const t = await getTranslations('AdminCatalog');
  return <PageSkeleton label={t('loading')} />;
}
