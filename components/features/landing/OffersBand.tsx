import { useTranslations } from 'next-intl';

import { LandingPhoto } from '@/components/features/landing/LandingPhoto';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

/** The offers band of `s1`. Plain process facts only: no quality claim before B7. */
export function OffersBand() {
  const t = useTranslations('Landing');

  return (
    <section className="mt-12 grid gap-3.5 lg:mt-17.5 lg:grid-cols-band">
      <LandingPhoto
        slot="land-provider"
        sizes="(min-width: 1024px) 49vw, 100vw"
        className="min-h-60 sm:min-h-80 lg:min-h-105"
      />
      <div className="flex flex-col justify-center rounded-panel bg-surface-secondary px-6.5 py-8 lg:px-11 lg:py-11.5">
        <h2 className="font-display text-section text-text-primary lg:text-band">{t('offersTitle')}</h2>
        <p className="mt-5.5 max-w-42ch text-lead text-text-body">{t('offersBody')}</p>
        <div className="mt-7.5 flex flex-wrap gap-2.5">
          <Button asChild size="band">
            <Link href={{ pathname: '/login', query: { mode: 'code', next: '/requests/new' } }}>
              {t('offersCta')}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="band">
            <Link href={{ pathname: '/login', query: { mode: 'code', as: 'provider' } }}>
              {t('ctaProvider')}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
