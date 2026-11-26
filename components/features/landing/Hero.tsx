import { useTranslations } from 'next-intl';

import { LandingPhoto } from '@/components/features/landing/LandingPhoto';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

const PROMISES = ['promise1', 'promise2', 'promise3', 'promise4'] as const;

/** The hero and the four promises of `s1`. */
export function Hero() {
  const t = useTranslations('Landing');

  return (
    <section>
      <div className="grid gap-3.5 lg:grid-cols-hero">
        <div className="flex flex-col rounded-panel bg-surface-inverse px-5 py-8 text-text-inverse sm:px-6.5 lg:px-10 lg:py-11">
          <h1 className="font-display text-title font-bold lg:text-band xl:text-hero">
            <span className="block">{t('heroLine1')}</span> <span className="block">{t('heroLine2')}</span>
          </h1>
          <p className="mt-6.5 max-w-36ch text-body-l">{t('heroBody')}</p>
          <div className="min-h-6.5 flex-1" />
          <Button asChild variant="white" size="hero" className="self-start">
            <Link href={{ pathname: '/login', query: { mode: 'code', next: '/requests/new' } }}>
              {t('heroCta')}
            </Link>
          </Button>
        </div>
        <LandingPhoto
          slot="land-hero"
          sizes="(min-width: 1024px) 53vw, 100vw"
          priority
          className="min-h-60 sm:min-h-80 lg:min-h-82.5"
        />
      </div>
      <ul className="mt-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {PROMISES.map((promise) => (
          <li
            key={promise}
            className="rounded-tile bg-surface-secondary px-6 py-5 text-body leading-normal font-semibold text-text-primary"
          >
            {t(promise)}
          </li>
        ))}
      </ul>
    </section>
  );
}
