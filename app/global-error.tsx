'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { dirFor, type Locale } from '@/lib/i18n/direction';
import { localeOfPath } from '@/lib/i18n/path-locale';
import { reportClientError } from '@/lib/observability/client';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

import './globals.css';

/**
 * The last resort: a crash that escapes the locale layout (spec 0004 AC-17). It replaces the whole
 * document, so no next-intl provider exists here: the locale is the first segment of the path when it
 * is a supported one, else the default, and the copy is the `Error` part of each catalogue, imported
 * statically. Direction comes from the locale, as everywhere (rule 10).
 *
 * Like the route boundary, it reports only a value without a `digest` (the server reported the rest).
 */

const COPY: Readonly<Record<Locale, typeof en.Error>> = { ar: ar.Error, tr: tr.Error, en: en.Error };

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const locale = localeOfPath(usePathname());
  const copy = COPY[locale];

  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-start justify-center gap-4 p-4 sm:p-8">
          <h1 className="text-2xl font-semibold text-text-primary">{copy.generic}</h1>
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
          >
            {copy.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
