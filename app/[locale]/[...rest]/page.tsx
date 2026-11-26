import { notFound } from 'next/navigation';

/**
 * Catch-all inside `[locale]` so every unmatched URL renders `app/[locale]/not-found.tsx`
 * inside `LocaleLayout` (preserving `<html lang dir>` and brand tokens) instead of Next's bare root 404.
 */
export default function CatchAllNotFound() {
  notFound();
}
