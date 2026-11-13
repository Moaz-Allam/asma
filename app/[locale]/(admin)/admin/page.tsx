import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';
import { Link } from '@/lib/i18n/navigation';
import { ADMIN_LINKS } from '@/lib/navigation/menus';

type Props = { params: Promise<{ locale: string }> };

/**
 * The admin home. `EmptyState` until position 16. Below `lg` the bottom bar has three tabs, so a row of
 * links reaches the rail's other pages (spec 0007 AC-16).
 */
export default async function Page({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const t = await getTranslations('Homes');
  const tNav = await getTranslations('Nav');

  return (
    <>
      <PageHeader title={t('adminTitle')} />
      <nav aria-label={t('adminLinks')} className="lg:hidden">
        <ul className="flex flex-wrap gap-2.5">
          {ADMIN_LINKS.map(({ key, href }) => (
            <li key={key}>
              <Link
                href={href}
                className="inline-flex min-h-11 items-center rounded-full bg-surface-secondary px-5.5 py-3 text-btn-sm text-text-primary"
              >
                {tNav(key)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <EmptyState lead={t('adminLead')} title={t('adminEmpty')} body={t('adminBody')} />
    </>
  );
}
