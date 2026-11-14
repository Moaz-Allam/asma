import { getTranslations } from 'next-intl/server';

import { PageSkeleton } from '@/components/shared/PageSkeleton';

/** Loading state for this segment and the pages under it (spec 0006 AC-27). */
export default async function Loading() {
  const t = await getTranslations('Provider');
  return <PageSkeleton label={t('loading')} />;
}
