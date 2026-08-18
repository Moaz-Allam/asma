'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * Route-level error boundary. ui-rules.md §4 and §7:
 * plain-language cause plus a retry — and NEVER a stack trace, SQL, or a PSP
 * payload. The `error` object is logged, not rendered.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('Error');

  useEffect(() => {
    // Server-side detail stays server-side; the digest is the correlation handle.
    console.error('[route-error]', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-start justify-center gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-text-primary">{t('generic')}</h1>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
      >
        {t('retry')}
      </button>
    </main>
  );
}
