'use client';

import { useLocale } from 'next-intl';
import { useTransition } from 'react';

import { LOCALES, type Locale } from '@/lib/i18n/direction';
import { usePathname, useRouter } from '@/lib/i18n/navigation';

/**
 * Language switcher. See context/i18n.md §4.
 *
 * Each language is labelled in its OWN script via `Intl.DisplayNames` rather than
 * hardcoded — a literal Arabic or Turkish string in a component is copy that
 * cannot be translated, and the guard hook rejects it.
 */
export function LocaleSwitcher() {
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onSelect(next: Locale) {
    if (next === active) return;
    // `routing` defines no `pathnames`, so the plain form is correct AND fully
    // typed — no cast. (The casted variant in the docs is only for the
    // `pathnames` case.) next-intl's cookie keeps the choice sticky.
    startTransition(() => router.replace(pathname, { locale: next }));
  }

  return (
    <nav aria-label="Language" className="flex items-center gap-2">
      {LOCALES.map((locale) => {
        const label = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            disabled={isPending}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => onSelect(locale)}
            className={[
              'rounded-md px-2 py-1 text-sm font-medium transition-colors',
              // Colour is never the only signal — aria-current carries it too.
              isActive
                ? 'bg-accent-muted text-accent'
                : 'text-text-secondary hover:bg-surface-secondary',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
