import { useTranslations } from 'next-intl';

import { CategoryIcon } from '@/components/features/landing/CategoryIcon';
import { CategoryRail } from '@/components/features/landing/CategoryRail';
import { SectionHead } from '@/components/features/landing/SectionHead';
import { Link } from '@/lib/i18n/navigation';
import { SAMPLE_CATEGORIES } from '@/lib/landing/samples';
import { cn } from '@/lib/utils';

/** The tile colour the design gives each category; the icon comes from `CategoryIcon`. */
const TILE: Readonly<Record<(typeof SAMPLE_CATEGORIES)[number], string>> = {
  home: 'bg-accent-light',
  deep: 'bg-accent-light',
  windows: 'bg-accent-muted',
  carpets: 'bg-accent-muted',
  other: 'bg-surface-secondary',
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
                className={cn('flex h-26 w-full items-center justify-center rounded-tile', TILE[category])}
              >
                <CategoryIcon category={category} className="size-9 text-accent" />
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
