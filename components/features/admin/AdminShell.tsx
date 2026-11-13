import type { ReactNode } from 'react';

import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { getProfile } from '@/lib/account/profile';
import { getSessionUser } from '@/lib/auth/session';
import { menuFor } from '@/lib/navigation/menus';
import { pendingCount } from '@/lib/provider/admin-queries';

import { AdminRail } from './AdminRail';

/**
 * The console frame (spec 0006 AC-13): the navy rail from `lg`, the normal header and `BottomTabBar` below
 * it. The count reads `providers` where status is pending, through RLS, so only an admin sees a number.
 * Each page's own `guardPage` is the check that holds.
 */
export async function AdminShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const role = user?.role ?? null;
  const pending = role === 'admin' ? await pendingCount().catch(() => 0) : 0;
  const items = role ? menuFor(role) : [];

  return (
    <div className="lg:flex lg:min-h-dvh">
      {role === 'admin' ? <AdminRail items={items} pending={pending} /> : null}
      <div className="min-w-0 flex-1">
        <SiteHeader
          user={role && profile ? { role, name: profile.fullName } : null}
          railFromLg={role === 'admin'}
        />
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 pb-28 lg:px-8.5 lg:pb-8.5">
          {children}
        </main>
      </div>
      {role ? <BottomTabBar items={items} counts={{ providers: pending }} /> : null}
    </div>
  );
}
