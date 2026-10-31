import { describe, expect, it } from 'vitest';

import { canOpen, firstStopFor, homeFor, landingFor, safeNext, type Role } from '@/lib/auth/roles';

/** Spec 0005 AC-10: where each role lands, and a `next` that can never leave the site. */

describe('homes', () => {
  it.each<[Role, string, string]>([
    ['customer', '/requests', '/requests/new'],
    ['provider', '/provider', '/provider/profile'],
    ['admin', '/admin', '/admin'],
  ])('%s: home %s, first stop %s', (role, home, first) => {
    expect(homeFor(role)).toBe(home);
    expect(firstStopFor(role)).toBe(first);
  });
});

describe('safeNext', () => {
  it.each([
    ['/requests', '/requests'],
    ['/requests/new', '/requests/new'],
    ['/provider', '/provider'],
    ['/provider/profile', '/provider/profile'],
    ['/admin', '/admin'],
    ['/account', '/account'],
    ['/requests?page=2', '/requests?page=2'],
    ['/tr/requests/new', '/requests/new'],
    ['/ar/account', '/account'],
  ])('keeps %s', (value, kept) => {
    expect(safeNext(value)).toBe(kept);
  });

  it.each([
    null,
    undefined,
    '',
    'requests',
    'https://evil.example',
    'https://evil.example/requests',
    '//evil.example',
    '//evil.example/requests',
    '/\\evil.example',
    '\\\\evil.example',
    '/\\/evil.example',
    '/requests\\..\\evil',
    'javascript:alert(1)',
    '/javascript:alert(1)',
    '/',
    '/tr',
    '/login',
    '/tr/login',
    '/onboarding',
    '/continue',
    '/requestsfoo',
    '/tr/tr/requests',
    '/requests/../login',
    '/requests/%2e%2e/login',
    '/requests/%2E%2E/login',
    '/requests/..%2flogin',
    '/requests/%5cevil',
    '/requests\nSet-Cookie: x=1',
    '/requests\tx',
    '/requests x',
    `/requests/${'a'.repeat(200)}`,
  ])('refuses %j', (value) => {
    expect(safeNext(value)).toBeNull();
  });
});

describe('landingFor', () => {
  it('honours a next the role may open', () => {
    expect(landingFor('customer', '/requests/new')).toBe('/requests/new');
    expect(landingFor('provider', '/provider/profile')).toBe('/provider/profile');
    expect(landingFor('admin', '/account')).toBe('/account');
  });

  it.each<[Role, string]>([
    ['customer', '/admin'],
    ['customer', '/provider'],
    ['provider', '/requests'],
    ['provider', '/admin'],
    ['admin', '/requests'],
  ])('sends %s home from %s', (role, next) => {
    expect(landingFor(role, next)).toBe(homeFor(role));
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example'])('ignores %s', (next) => {
    expect(landingFor('customer', next)).toBe('/requests');
  });

  it('goes home with no next', () => {
    expect(landingFor('provider', null)).toBe('/provider');
  });
});

describe('canOpen', () => {
  it('reads the section, not the prefix', () => {
    expect(canOpen('customer', '/requests')).toBe(true);
    expect(canOpen('customer', '/requests/new?x=1')).toBe(true);
    expect(canOpen('customer', '/requestsfoo')).toBe(false);
    expect(canOpen('provider', '/provider/profile')).toBe(true);
  });
});
