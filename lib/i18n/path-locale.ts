import { isLocale, type Locale } from '@/lib/i18n/direction';
import { routing } from '@/lib/i18n/routing';

/**
 * The locale a path names in its first segment, else the default. For the global error page (spec 0004
 * AC-17), which replaces the whole document, so no next-intl provider is there to ask. Exact match only:
 * `/TR/x` is not Turkish, and an identifier is never case folded (rule 10).
 */
export function localeOfPath(pathname: string | null | undefined): Locale {
  const segment = pathname?.split('/')[1] ?? '';
  return isLocale(segment) ? segment : routing.defaultLocale;
}
