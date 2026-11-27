import { getTranslations } from 'next-intl/server';

import { PageSkeleton } from '@/components/shared/PageSkeleton';

/** Loading state for account, notifications, and agreement routes (`ui-rules.md` §4). */
export default async function Loading() {
  const t = await getTranslations('Requests');
  return <PageSkeleton label={t('states.loading')} variant="split" />;
}
