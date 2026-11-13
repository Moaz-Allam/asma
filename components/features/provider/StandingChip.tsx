import { getTranslations } from 'next-intl/server';

import { StatusChip, type ChipTone } from '@/components/shared/StatusChip';
import type { Standing } from '@/lib/provider/options';

/** The standing → chip mapping of spec 0006 Feature design (D59 for the first three). */
export const STANDING_TONE: Readonly<Record<Standing, ChipTone>> = {
  pending: 'waiting',
  approved: 'waiting',
  rejected: 'negative',
  suspended: 'negative',
  document_expired: 'negative',
  draft: 'neutral',
};

/** The provider's standing in the header of every provider page (AC-10). */
export async function StandingChip({ standing }: { standing: Standing }) {
  const t = await getTranslations('Provider.standing');
  return <StatusChip tone={STANDING_TONE[standing]} label={t(standing)} />;
}
