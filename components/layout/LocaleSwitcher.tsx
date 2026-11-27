'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { updateLocale } from '@/actions/account';
import { track } from '@/lib/analytics/client';
import { LOCALES, isLocale, type Locale } from '@/lib/i18n/direction';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Language switcher. See context/i18n.md §4, spec 0005 AC-19.
 *
 * Each language is labelled in its OWN script via `Intl.DisplayNames` rather than
 * hardcoded — a literal Arabic or Turkish string in a component is copy that
 * cannot be translated, and the guard hook rejects it.
 *
 * `signedIn` saves the choice to `profiles.locale` too, which wins after the next sign in. A visitor
 * has only the cookie.
 */
export function LocaleSwitcher({ signedIn = false }: { signedIn?: boolean }) {
  const t = useTranslations('Nav');
  const tAccount = useTranslations('Account.errors');
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [saveFailed, setSaveFailed] = useState(false);

  function onSelect(next: Locale) {
    if (next === active) return;
    startTransition(async () => {
      if (signedIn) {
        const result = await updateLocale({ locale: next });
        if (!result.ok) {
          setSaveFailed(true);
          return;
        }
      }
      setSaveFailed(false);
      if (isLocale(active)) track('locale_changed', { from_locale: active, to_locale: next });
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <div>
      <nav
        aria-label={t('language')}
        className="flex w-fit items-center gap-1.5 rounded-full bg-surface-secondary p-1.25"
      >
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
              className={cn(
                'rounded-full px-5 py-2.5 text-btn-sm transition-colors',
                // Colour is never the only signal — aria-current carries it too.
                isActive ? 'bg-accent text-accent-foreground' : 'text-text-primary hover:bg-accent-muted',
              )}
            >
              {label}
            </button>
          );
        })}
      </nav>
      {saveFailed ? (
        <p role="status" className="mt-2 text-body-s text-error">
          {tAccount('action_failed')}
        </p>
      ) : null}
    </div>
  );
}
