import type { Metadata } from 'next';

import type { Role } from '@/lib/auth/roles';

/** The role menu: only pages that exist (D99). A later position adds its own row with its page. */

export type MenuItem = {
  key: 'requests' | 'newRequest' | 'dashboard' | 'profile' | 'account' | 'providers';
  href: string;
};

const MENUS: Readonly<Record<Role, readonly MenuItem[]>> = {
  customer: [
    { key: 'requests', href: '/requests' },
    { key: 'newRequest', href: '/requests/new' },
    { key: 'account', href: '/account' },
  ],
  provider: [
    { key: 'dashboard', href: '/provider' },
    { key: 'profile', href: '/provider/profile' },
    { key: 'account', href: '/account' },
  ],
  // Spec 0006 AC-13: built pages only. Later positions add their rows.
  admin: [
    { key: 'dashboard', href: '/admin' },
    { key: 'providers', href: '/admin/providers' },
    { key: 'account', href: '/account' },
  ],
};

export function menuFor(role: Role): readonly MenuItem[] {
  return MENUS[role];
}

/**
 * The one menu item a path belongs to: the longest href that equals the path or is a folder of it. So
 * `/requests/new` lights only New request, never Requests too, and `/admin/providers/x` lights Providers,
 * not Dashboard. Null when the path is under no item.
 */
export function activeMenuKey(items: readonly MenuItem[], pathname: string): MenuItem['key'] | null {
  let best: MenuItem | null = null;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === null || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** The sections of the landing page, in the header and the phone menu (spec 0005 AC-27). */
export const PUBLIC_ANCHORS = [
  { key: 'categories', hash: 'categories' },
  { key: 'prices', hash: 'prices' },
  { key: 'how', hash: 'how' },
  { key: 'faq', hash: 'faq' },
] as const;

/** Every private page, always (spec 0005 AC-17). */
export const PRIVATE_PAGE_METADATA: Metadata = { robots: { index: false, follow: false } };
