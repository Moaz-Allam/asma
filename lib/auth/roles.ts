import { LOCALES } from '@/lib/i18n/direction';

/**
 * Roles and where they land (spec 0005 AC-10). No `server-only`: the login page's client code needs
 * `safeNext` too. Paths here carry no locale; `lib/i18n/navigation` adds it.
 */

export const ROLES = ['customer', 'provider', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

const HOME: Readonly<Record<Role, string>> = {
  customer: '/requests',
  provider: '/provider',
  admin: '/admin',
};

const FIRST_STOP: Readonly<Record<Role, string>> = {
  customer: '/requests/new',
  provider: '/provider/profile',
  admin: '/admin',
};

/** The sections a role may open. Everyone has `/account`. */
const SECTIONS: Readonly<Record<Role, readonly string[]>> = {
  customer: ['/requests', '/account'],
  provider: ['/provider', '/account'],
  admin: ['/admin', '/account'],
};

/** Where a `next` may point, after the locale. */
const NEXT_SECTIONS = ['/requests', '/provider', '/admin', '/account'];

/** Where a role lands after a later sign in. */
export function homeFor(role: Role): string {
  return HOME[role];
}

/** Where a role lands right after onboarding. */
export function firstStopFor(role: Role): string {
  return FIRST_STOP[role];
}

function inSection(path: string, section: string): boolean {
  const route = path.split(/[?#]/, 1)[0];
  return route === section || route?.startsWith(`${section}/`) === true;
}

export function canOpen(role: Role, path: string): boolean {
  return SECTIONS[role].some((section) => inSection(path, section));
}

const LOCALE_PREFIX = new RegExp(`^/(?:${LOCALES.join('|')})(?=/)`);

/**
 * A `next` query value that is safe to redirect to, without its locale, or null. Everything is refused
 * unless it is plainly a path in one of our sections: a scheme, a second leading slash, a backslash, a
 * dot segment, whitespace or a control character, spelled out or percent encoded.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length >= 200) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\\\s\p{Cc}]|\.\.|:|%2e|%2f|%5c/iu.test(value)) return null;
  const path = value.replace(LOCALE_PREFIX, '');
  return NEXT_SECTIONS.some((section) => inSection(path, section)) ? path : null;
}

/** A safe `next` the role may open, else their home. */
export function landingFor(role: Role, next: string | null | undefined): string {
  const path = safeNext(next);
  return path !== null && canOpen(role, path) ? path : homeFor(role);
}
