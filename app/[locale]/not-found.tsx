import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

/**
 * Branded `s17` 404 page (`ui-rules.md` §4, `ui-registry.md` `NotFound`): reached by `notFound()`
 * in the locale layout, dynamic pages, and `[...rest]/page.tsx`.
 */
export default function NotFound() {
  const t = useTranslations('Error');

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col justify-center gap-8 px-5 py-8 lg:px-8.5"
    >
      <Link href="/" dir="ltr" className="self-start font-wordmark text-wordmark text-text-primary">
        Aldebyani
      </Link>
      <section className="flex flex-col items-start gap-4 rounded-panel bg-surface-secondary p-7 lg:p-11">
        <p aria-hidden className="font-display text-display text-text-primary">
          404
        </p>
        <h1 className="font-display text-title-s text-text-primary">{t('notFound')}</h1>
        <p className="max-w-52ch text-body text-text-secondary">{t('notFoundBody')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/">{t('backHome')}</Link>
          </Button>
          <Button asChild variant="white" size="lg">
            <Link href="/requests">{t('notFoundRequests')}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
