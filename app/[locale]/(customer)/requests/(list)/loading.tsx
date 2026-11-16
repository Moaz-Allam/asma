import { getTranslations } from 'next-intl/server';

import { PageSkeleton } from '@/components/shared/PageSkeleton';

/** Loading state of my requests (spec 0008 AC-24). */
export default async function Loading() {
  const t = await getTranslations('Requests');
  return <PageSkeleton label={t('states.loading')} />;
}
