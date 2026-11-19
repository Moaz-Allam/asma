import { reportServerError } from '@/lib/observability/server';
import type { ReactNode } from 'react';

import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { getProfile } from '@/lib/account/profile';
import { getSessionUser } from '@/lib/auth/session';
import { ADMIN_RAIL, menuFor } from '@/lib/navigation/menus';
import { openReportsCount } from '@/lib/admin-reports';
import { pendingCount } from '@/lib/provider/admin-queries';

import { AdminRail } from './AdminRail';

/**
 * The console frame (spec 0006 AC-13, spec 0007 AC-16): the navy rail of `ADMIN_RAIL` from `lg`, the normal header and `BottomTabBar` below
 * it. The count reads `providers` where status is pending, through RLS, so only an admin sees a number.
 * Each page's own `guardPage` is the check that holds.
 */
export async function AdminShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const role = user?.role ?? null;
  // A failed count shows no badge, but it is reported, never silent.
  const pending =
    role === 'admin'
      ? await pendingCount().catch((error: unknown) => {
          reportServerError('adminShell', error);
          return 0;
        })
      : 0;
  // Spec 0011-14 AC-4: the open reports on the rail; a failed count shows no badge and is reported.
  const reports =
    role === 'admin'
      ? await openReportsCount().catch((error: unknown) => {
          reportServerError('adminShellReports', error);
          return 0;
        })
      : 0;
  const items = role ? menuFor(role) : [];

  return (
    <div className="lg:flex lg:min-h-dvh">
      {role === 'admin' ? <AdminRail items={ADMIN_RAIL} pending={pending} reports={reports} /> : null}
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
