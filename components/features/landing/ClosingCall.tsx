import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

/** The closing panel of `s1`, reworded: under the cash model the commission comes before the job (D88). */
export function ClosingCall() {
  const t = useTranslations('Landing');

  return (
    <section className="mt-12 flex flex-col gap-6 rounded-panel bg-surface-inverse px-6.5 py-8 lg:mt-17.5 lg:flex-row lg:items-end lg:gap-10 lg:px-11.5 lg:py-13">
      <h2 className="flex-1 font-display text-title text-text-inverse lg:text-close">
        <span className="block">{t('closingLine1')}</span> <span className="block">{t('closingLine2')}</span>
      </h2>
      <div className="flex flex-col items-start gap-3">
        <p className="max-w-32ch text-label leading-relaxed font-medium text-accent-light">
          {t('closingBody')}
        </p>
        <Button asChild variant="white" size="hero" className="px-8 text-link">
          <Link href={{ pathname: '/login', query: { mode: 'code', next: '/requests/new' } }}>
            {t('offersCta')}
          </Link>
        </Button>
      </div>
    </section>
  );
}
