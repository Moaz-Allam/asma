import { describe, expect, it } from 'vitest';

import { activeMenuKey, menuFor, PROVIDER_LINKS, PROVIDER_NAV } from '@/lib/navigation/menus';

/**
 * Exactly one menu item is current for a path, for every role (ui-rules.md §14, spec 0006 AC-13). The
 * slice review of PR #26 found `/requests/new` lighting both Requests and New request.
 */

describe('activeMenuKey', () => {
  it.each([
    ['/requests', 'requests'],
    ['/requests/new', 'newRequest'],
    ['/requests/123', 'requests'],
    ['/account', 'account'],
    ['/provider', null],
  ] as const)('customer on %s: %s', (path, key) => {
    expect(activeMenuKey(menuFor('customer'), path)).toBe(key);
  });

  it.each([
    ['/provider', 'dashboard'],
    ['/provider/feed', 'feed'],
    ['/provider/feed/00000000-0000-4000-8000-000000000001', 'feed'],
    ['/provider/applications', 'applications'],
    ['/provider/profile', 'dashboard'],
    ['/account', null],
  ] as const)('provider tabs on %s: %s', (path, key) => {
    expect(activeMenuKey(menuFor('provider'), path)).toBe(key);
  });

  it.each([
    ['/provider/setup', 'setup'],
    ['/provider/history', 'history'],
    ['/provider/profile', 'profile'],
    ['/provider/profile/documents', 'profile'],
    ['/account', 'account'],
  ] as const)('provider header on %s: %s (spec 0009 AC-15)', (path, key) => {
    expect(activeMenuKey(PROVIDER_NAV, path)).toBe(key);
  });

  it('the provider bar keeps three tabs, and the home links every other page', () => {
    expect(menuFor('provider')).toHaveLength(3);
    expect(PROVIDER_LINKS.map((item) => item.key)).toEqual(['history', 'setup', 'profile', 'account']);
  });

  it.each([
    ['/admin', 'dashboard'],
    ['/admin/providers', 'providers'],
    ['/admin/providers/00000000-0000-4000-8000-000000000001', 'providers'],
    ['/account', 'account'],
  ] as const)('admin on %s: %s', (path, key) => {
    expect(activeMenuKey(menuFor('admin'), path)).toBe(key);
  });

  it('never treats a longer word as a folder', () => {
    expect(activeMenuKey(menuFor('customer'), '/requestsx')).toBeNull();
  });
});
