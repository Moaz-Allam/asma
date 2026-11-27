'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import { reportClientError } from '@/lib/observability/client';

/**
 * Route-level error boundary (`s17`, `ui-rules.md` §4 and §7): plain-language cause, what stayed safe,
 * and retry + home pills — NEVER a stack trace, SQL, or PSP payload.
 *
 * Reporting (spec 0004 AC-17): only a value without a `digest`.
 */
export default function ErrorBoundary({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('Error');

  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col justify-center gap-8 px-5 py-8 lg:px-8.5"
    >
      <Link href="/" dir="ltr" className="self-start font-wordmark text-wordmark text-text-primary">
        Aldebyani
      </Link>
      <section
        role="alert"
        className="flex flex-col items-start gap-4 rounded-panel bg-error-light p-7 lg:p-11"
      >
        <p aria-hidden className="font-display text-display text-text-primary">
          !
        </p>
        <h1 className="font-display text-title-s text-text-primary">{t('generic')}</h1>
        <p className="max-w-52ch text-body text-text-secondary">{t('genericBody')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => retry()}>
            {t('retry')}
          </Button>
          <Button asChild variant="white" size="lg">
            <Link href="/">{t('backHome')}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
