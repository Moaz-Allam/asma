import { useTranslations } from 'next-intl';

import { CategoryRail } from '@/components/features/landing/CategoryRail';
import { SectionHead } from '@/components/features/landing/SectionHead';
import { Link } from '@/lib/i18n/navigation';
import { SAMPLE_CATEGORIES } from '@/lib/landing/samples';
import { cn } from '@/lib/utils';

/** The tile colour and the plain shape the design gives each category. */
const LOOK: Readonly<Record<(typeof SAMPLE_CATEGORIES)[number], { tile: string; mark: string }>> = {
  home: { tile: 'bg-accent-light', mark: 'rounded-full bg-accent' },
  deep: { tile: 'bg-accent-light', mark: 'rounded-xs bg-accent' },
  windows: { tile: 'bg-accent-muted', mark: 'scale-82 rotate-45 rounded-xs bg-accent' },
  carpets: { tile: 'bg-accent-muted', mark: 'rounded-full border-9 border-accent' },
  other: { tile: 'bg-surface-secondary', mark: 'rounded-xs bg-accent' },
};

/** The categories of `s1`, as drawn, until the catalog replaces them (AC-28). */
export function Categories() {
  const t = useTranslations('Landing');

  return (
    <section id="categories" className="scroll-mt-6 pt-12 lg:pt-17.5">
      <SectionHead title={t('categoriesTitle')} action={t('categoriesAll')} className="mb-6.5" />
      <CategoryRail previous={t('categoriesPrevious')} next={t('categoriesNext')}>
        {SAMPLE_CATEGORIES.map((category) => (
          <li key={category} className="w-36 shrink-0 snap-start lg:w-auto">
            <Link
              href={{ pathname: '/login', query: { mode: 'code', next: '/requests/new' } }}
              className="flex flex-col items-center gap-3"
            >
              <span
                className={cn(
                  'flex h-26 w-full items-center justify-center rounded-tile',
                  LOOK[category].tile,
                )}
              >
                <span className={cn('size-7.5', LOOK[category].mark)} />
              </span>
              <span className="text-label text-text-primary">{t(`category.${category}`)}</span>
            </Link>
          </li>
        ))}
      </CategoryRail>
      <p className="mt-5 text-body-s text-text-secondary">{t('categoriesNote')}</p>
    </section>
  );
}
