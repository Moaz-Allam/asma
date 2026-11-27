import { useTranslations } from 'next-intl';

/** Keyboard skip-to-content link (WCAG 2.4.1, `ui-rules.md` §8). Logical positioning only. */
export function SkipLink() {
  const t = useTranslations('Nav');
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-accent focus:px-5.5 focus:py-3 focus:text-btn-sm focus:text-accent-foreground focus:shadow-overlay"
    >
      {t('skipToContent')}
    </a>
  );
}
