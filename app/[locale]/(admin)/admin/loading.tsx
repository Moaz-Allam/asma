import { getTranslations } from 'next-intl/server';

import { PageSkeleton } from '@/components/shared/PageSkeleton';

/** Loading state for the admin console dashboard and sub-routes (`ui-rules.md` §4). */
export default async function Loading() {
  const t = await getTranslations('AdminCatalog');
  return <PageSkeleton label={t('loading')} variant="dashboard" />;
}
