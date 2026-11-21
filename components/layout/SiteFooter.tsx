import { useTranslations } from 'next-intl';

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { SupportLink } from '@/components/shared/SupportLink';
import { Link } from '@/lib/i18n/navigation';

const LINK = 'hover:text-link';

/** The footer of `s1`, with the language added. The support link appears only when the region has a number (AC-34). */
export function SiteFooter({ whatsapp }: { whatsapp: string | null | undefined }) {
  const t = useTranslations('Footer');

  return (
    <footer className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6.5 gap-y-3 px-5 pt-6.5 pb-7.5 text-body-s text-text-secondary lg:px-8.5">
      <p>{t('copyright', { year: 2026 })}</p>
      <nav aria-label={t('label')} className="flex flex-wrap items-center gap-x-6.5 gap-y-3">
        <Link href="/terms" className={LINK}>
          {t('terms')}
        </Link>
        <Link href="/privacy" className={LINK}>
          {t('privacy')}
        </Link>
        <Link href={{ pathname: '/login', query: { mode: 'code', as: 'provider' } }} className={LINK}>
          {t('joinProvider')}
        </Link>
        <SupportLink whatsapp={whatsapp} label={t('support')} className={LINK} />
      </nav>
      <div className="ms-auto">
        <LocaleSwitcher />
      </div>
    </footer>
  );
}
