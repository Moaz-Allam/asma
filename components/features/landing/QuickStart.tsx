import Image from 'next/image';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import { SAMPLE_SERVICES } from '@/lib/landing/samples';
import { cn } from '@/lib/utils';

const STEPS = [1, 2, 3] as const;

/** The design's photo for each service tile. */
const THUMB: Readonly<Record<(typeof SAMPLE_SERVICES)[number], string>> = {
  regular: 'cat-home',
  deep: 'hero-clean-bath',
  windows: 'work-windows',
  ironing: 'work-furniture',
  oven: 'work-kitchen',
  carpets: 'work-furniture',
  ac: 'cat-home',
  moveOut: 'move',
};

function ServiceTile({
  service,
  copy = false,
}: {
  service: (typeof SAMPLE_SERVICES)[number];
  copy?: boolean;
}) {
  const t = useTranslations('Landing');

  return (
    <li aria-hidden={copy || undefined} className="shrink-0">
      <Link
        href={{ pathname: '/login', query: { mode: 'code', next: '/requests/new' } }}
        tabIndex={copy ? -1 : undefined}
        className="flex flex-col items-start gap-2.5 rounded-row bg-surface p-3.5 sm:flex-row sm:items-center sm:gap-3.5"
      >
        <Image
          src={`/landing/${THUMB[service]}.jpg`}
          alt=""
          width={56}
          height={56}
          className="size-14 shrink-0 rounded-sm object-cover"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-body font-bold">{t(`service.${service}`)}</span>
          <span className="mt-0.75 block text-meta font-normal text-text-secondary">
            {t(`serviceNote.${service}`)}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** One moving column. The list runs twice, so the loop has no seam; the copy is hidden from readers. */
function TileColumn({
  services,
  motion,
}: {
  services: readonly (typeof SAMPLE_SERVICES)[number][];
  motion: string;
}) {
  return (
    <div className="overflow-hidden">
      <ul className={cn('flex flex-col gap-3 hover:animation-paused', motion)}>
        {services.map((service) => (
          <ServiceTile key={service} service={service} />
        ))}
        {services.map((service) => (
          <ServiceTile key={service} service={service} copy />
        ))}
      </ul>
    </div>
  );
}

/** The quick start of `s1`, with its two columns of service tiles moving in opposite directions. */
export function QuickStart() {
  const t = useTranslations('Landing');

  return (
    <section className="mt-12 grid items-start gap-3.5 lg:mt-17.5 lg:grid-cols-quick">
      <div className="flex flex-col items-start lg:pt-5">
        <h2 className="font-display text-title text-text-primary lg:text-quick">{t('quickTitle')}</h2>
        <p className="mt-5 mb-7.5 max-w-40ch text-lead text-text-body">{t('quickBody')}</p>
        <ol className="mb-8 flex flex-col gap-3.5">
          {STEPS.map((step) => (
            <li key={step} className="flex items-center gap-3.5 text-nav text-text-primary">
              <span
                aria-hidden
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full font-display text-label font-extrabold',
                  step === 3 ? 'bg-accent-muted' : 'bg-accent-light',
                )}
              >
                {step}
              </span>
              {t(`quickStep${step}`)}
            </li>
          ))}
        </ol>
        <Button asChild size="band" className="px-8">
          <Link href={{ pathname: '/login', query: { mode: 'code', next: '/requests/new' } }}>
            {t('cta')}
          </Link>
        </Button>
      </div>
      <div className="grid h-110 grid-cols-2 gap-3 overflow-hidden rounded-panel bg-surface-secondary p-3 mask-tiles sm:p-5.5">
        <TileColumn services={SAMPLE_SERVICES.slice(0, 4)} motion="animate-tiles-up" />
        <TileColumn services={SAMPLE_SERVICES.slice(4)} motion="animate-tiles-down" />
      </div>
    </section>
  );
}
