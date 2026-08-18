import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware navigation. Use these in place of the `next/link` and
 * `next/navigation` equivalents — they keep the active locale on every
 * transition and are fully typed against `routing`.
 *
 * Importing `next/link` directly in a page is a bug: it drops the locale.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
