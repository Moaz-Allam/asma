import { useTranslations } from 'next-intl';

import { Link } from '@/lib/i18n/navigation';

/**
 * Reached by `notFound()` in the layout when the URL carries an unknown locale,
 * and by any missing route. ui-rules.md §4 — never ship only the happy path.
 */
export default function NotFound() {
  const t = useTranslations('Error');

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col items-start justify-center gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-text-primary">{t('notFound')}</h1>
      <Link href="/" className="text-sm font-medium text-accent underline-offset-4 hover:underline">
        {t('backHome')}
      </Link>
    </main>
  );
}
