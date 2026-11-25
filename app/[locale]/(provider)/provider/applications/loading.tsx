import { getTranslations } from 'next-intl/server';

import { PageSkeleton } from '@/components/shared/PageSkeleton';

/** Loading state for provider applications & jobs list (`ui-rules.md` §4). */
export default async function Loading() {
  const t = await getTranslations('Provider');
  return <PageSkeleton label={t('loading')} variant="list" />;
}
