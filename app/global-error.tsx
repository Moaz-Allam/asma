'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { fontVariables } from '@/lib/fonts';
import { dirFor, type Locale } from '@/lib/i18n/direction';
import { localeOfPath } from '@/lib/i18n/path-locale';
import { reportClientError } from '@/lib/observability/client';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';

import './globals.css';

/**
 * The last resort: a crash that escapes the locale layout (spec 0004 AC-17, `s17`).
 * Direction comes from the locale, as everywhere (rule 10). Never renders the raw error.
 */

const COPY: Readonly<Record<Locale, typeof en.Error>> = { ar: ar.Error, tr: tr.Error, en: en.Error };

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const locale = localeOfPath(usePathname());
  const copy = COPY[locale];

  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang={locale} dir={dirFor(locale)} className={fontVariables}>
      <body>
        <main
          id="main-content"
          className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col justify-center gap-8 px-5 py-8 lg:px-8.5"
        >
          <a
            href={`/${locale}`}
            dir="ltr"
            className="self-start font-wordmark text-wordmark text-text-primary"
          >
            Aldebyani
          </a>
          <section
            role="alert"
            className="flex flex-col items-start gap-4 rounded-panel bg-error-light p-7 lg:p-11"
          >
            <p aria-hidden className="font-display text-display text-text-primary">
              !
            </p>
            <h1 className="font-display text-title-s text-text-primary">{copy.generic}</h1>
            <p className="max-w-52ch text-body text-text-secondary">{copy.genericBody}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => retry()}
                className="inline-flex items-center justify-center rounded-full bg-accent px-6.5 py-4 text-btn text-accent-foreground transition hover:bg-link"
              >
                {copy.retry}
              </button>
              <a
                href={`/${locale}`}
                className="inline-flex items-center justify-center rounded-full bg-surface px-6.5 py-4 text-btn text-text-primary transition hover:bg-surface-secondary"
              >
                {copy.backHome}
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
