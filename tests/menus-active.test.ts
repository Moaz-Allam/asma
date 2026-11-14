import { describe, expect, it } from 'vitest';

import { activeMenuKey, menuFor } from '@/lib/navigation/menus';

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
    ['/provider/profile', 'profile'],
    ['/provider/profile/documents', 'profile'],
    ['/account', 'account'],
  ] as const)('provider on %s: %s', (path, key) => {
    expect(activeMenuKey(menuFor('provider'), path)).toBe(key);
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
