import type { Metadata } from 'next';

import type { Role } from '@/lib/auth/roles';

/** The role menu: only pages that exist (D99). A later position adds its own row with its page. */

export type MenuItem = {
  key:
    | 'requests'
    | 'newRequest'
    | 'dashboard'
    | 'profile'
    | 'account'
    | 'publicAccount'
    | 'providers'
    | 'catalog'
    | 'pricing'
    | 'feed'
    | 'applications'
    | 'setup'
    | 'reports'
    | 'flags'
    | 'revenue'
    | 'quality'
    | 'agreements'
    | 'history';
  href: string;
};

const MENUS: Readonly<Record<Role, readonly MenuItem[]>> = {
  customer: [
    { key: 'requests', href: '/requests' },
    { key: 'newRequest', href: '/requests/new' },
    { key: 'account', href: '/account' },
  ],
  // Spec 0009 AC-15: the phone tabs are the daily work. Setup, profile and account sit in the header from
  // `lg` (`PROVIDER_NAV`) and as links on `/provider` below it (`PROVIDER_LINKS`), as the admin rail does.
  provider: [
    { key: 'feed', href: '/provider/feed' },
    { key: 'applications', href: '/provider/applications' },
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

/** Every provider page, in the header from `lg` (spec 0009 AC-15). */
export const PROVIDER_NAV: readonly MenuItem[] = [
  { key: 'feed', href: '/provider/feed' },
  { key: 'applications', href: '/provider/applications' },
  // Spec 0011-15 R-12: the jobs and fees history, in the header and the links on `/provider`, not a phone tab.
  { key: 'history', href: '/provider/history' },
  { key: 'setup', href: '/provider/setup' },
  { key: 'publicAccount', href: '/account' },
];

/**
 * Spec 0011-15 X-12: the history's label lives at `History.nav`, so its word test (R-13) covers the menu too. Every
 * other item reads `Nav.<key>`.
 */
export function menuLabelKey(key: MenuItem['key']): string {
  return key === 'history' ? 'History.nav' : `Nav.${key}`;
}

/** The provider pages the bottom bar has no tab for, linked from `/provider` below `lg`. */
export const PROVIDER_LINKS: readonly MenuItem[] = PROVIDER_NAV.filter(
  (item) => !MENUS.provider.some((tab) => tab.key === item.key),
);

/** The header's menu from `lg`: every page of the role. */
export function headerMenuFor(role: Role): readonly MenuItem[] {
  return role === 'provider' ? PROVIDER_NAV : MENUS[role];
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

/**
 * The console rail from `lg` (spec 0007 AC-16): every admin page that exists. The bottom bar keeps the three
 * tabs of `menuFor('admin')`, so below `lg` the page `/admin` links to the rest (`ADMIN_LINKS`).
 */
export const ADMIN_RAIL: readonly MenuItem[] = [
  { key: 'dashboard', href: '/admin' },
  { key: 'providers', href: '/admin/providers' },
  // Spec 0011-16 R-12: the request list, the flag queue (with its open count) and revenue.
  { key: 'requests', href: '/admin/requests' },
  { key: 'flags', href: '/admin/flags' },
  // Spec 0011-14 AC-4: the report queue, with its open count.
  { key: 'reports', href: '/admin/reports' },
  { key: 'revenue', href: '/admin/revenue' },
  // Spec 0011-19a AC-10: the watchlist, probation and the funnel.
  { key: 'quality', href: '/admin/quality' },
  // Spec 0011-20 AC-10: every service agreement, each view audited.
  { key: 'agreements', href: '/admin/agreements' },
  { key: 'catalog', href: '/admin/catalog' },
  { key: 'pricing', href: '/admin/pricing' },
  { key: 'account', href: '/account' },
];

/** The rail's pages the bottom bar has no tab for, linked from `/admin` below `lg`. */
export const ADMIN_LINKS: readonly MenuItem[] = ADMIN_RAIL.filter(
  (item) => !MENUS.admin.some((tab) => tab.key === item.key),
);

/** The sections of the landing page, in the header and the phone menu (spec 0005 AC-27). */
export const PUBLIC_ANCHORS = [
  { key: 'categories', hash: 'categories' },
  { key: 'prices', hash: 'prices' },
  { key: 'how', hash: 'how' },
  { key: 'faq', hash: 'faq' },
] as const;

/** Every private page, always (spec 0005 AC-17). */
export const PRIVATE_PAGE_METADATA: Metadata = { robots: { index: false, follow: false } };
