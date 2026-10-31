'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { reportClientError } from '@/lib/observability/client';

/**
 * Route-level error boundary. ui-rules.md §4 and §7:
 * plain-language cause plus a retry — and NEVER a stack trace, SQL, or a PSP
 * payload. The thrown value is reported, not rendered.
 *
 * Reporting (spec 0004 AC-17): only a value without a `digest`. A digest means the server rendered the
 * error and `onRequestError` has already reported it, so the boundary stays quiet to count it once.
 */
export default function ErrorBoundary({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('Error');

  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-start justify-center gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-text-primary">{t('generic')}</h1>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
      >
        {t('retry')}
      </button>
    </main>
  );
}
