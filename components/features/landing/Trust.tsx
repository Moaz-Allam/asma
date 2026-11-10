import { useTranslations } from 'next-intl';

import { LandingPhoto } from '@/components/features/landing/LandingPhoto';
import { cn } from '@/lib/utils';

const POINTS = [1, 2, 3] as const;
const CARDS = [
  { key: 1, tone: 'bg-accent-muted' },
  { key: 2, tone: 'bg-accent-light' },
] as const;

/**
 * The trust section of `s1`, rewritten: the design's "protection" was the held money, which is gone (D87).
 * What stays true is how contact details open, how providers are checked, and where ratings come from.
 */
export function Trust() {
  const t = useTranslations('Landing');

  return (
    <section className="mt-3.5 grid gap-3.5 lg:grid-cols-band">
      <div className="flex flex-col justify-center rounded-panel bg-accent-light px-6.5 py-8 lg:px-10.5 lg:py-11">
        <h2 className="font-display text-section text-text-primary lg:text-band-s">{t('trustTitle')}</h2>
        <p className="mt-5 mb-7.5 max-w-40ch text-body leading-relaxed text-text-primary">{t('trustBody')}</p>
        <ul className="flex flex-col gap-3.5">
          {POINTS.map((point) => (
            <li key={point} className="rounded-tile bg-surface px-5.5 py-5">
              <h3 className="font-sans text-body-l font-bold text-text-primary">{t(`trust${point}Title`)}</h3>
              <p className="mt-1.25 text-body-s font-normal text-text-secondary">{t(`trust${point}Body`)}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3.5">
        <LandingPhoto
          slot="land-customer"
          sizes="(min-width: 1024px) 49vw, 100vw"
          className="min-h-60 flex-1 sm:min-h-80 lg:min-h-75"
        />
        <div className="grid grid-cols-2 gap-3.5">
          {CARDS.map(({ key, tone }) => (
            <div
              key={key}
              className={cn(
                'min-w-0 rounded-card px-4 py-4 wrap-break-word text-text-primary sm:px-6 sm:py-5.5',
                tone,
              )}
            >
              <p className="text-eyebrow">{t(`trustCard${key}Label`)}</p>
              <p className="mt-2 font-display text-tile">{t(`trustCard${key}Value`)}</p>
              <p className="mt-1.5 text-meta">{t(`trustCard${key}Note`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
