import { getTranslations } from 'next-intl/server';
import { reportServerError } from '@/lib/observability/server';
import type { ReactNode } from 'react';

import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SkipLink } from '@/components/layout/SkipLink';
import { getProfile } from '@/lib/account/profile';
import { getSessionUser } from '@/lib/auth/session';
import { ADMIN_RAIL, menuFor } from '@/lib/navigation/menus';
import { openReportsCount } from '@/lib/admin-reports';
import { listFlags } from '@/lib/admin-requests';
import { noticeCount } from '@/lib/notifications/centre';
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
  // Spec 0011-16 R-12: the open flags on the rail; a failed count shows no badge and is reported.
  const flags =
    role === 'admin'
      ? await listFlags(1)
          .then((queue) => queue.total)
          .catch((error: unknown) => {
            reportServerError('adminShellFlags', error);
            return 0;
          })
      : 0;
  // Spec 0011-18 AC-8: the bell's first count; a failed read shows no badge and is reported.
  const notices =
    user && role
      ? await noticeCount().catch((error: unknown) => {
          reportServerError('noticeCount', error);
          return null;
        })
      : null;
  const items = role ? menuFor(role) : [];
  const tHomes = await getTranslations('Homes');

  return (
    <div className="relative lg:flex lg:min-h-dvh">
      <SkipLink />
      {role === 'admin' ? (
        <AdminRail
          items={ADMIN_RAIL}
          pending={pending}
          reports={reports}
          flags={flags}
          note={tHomes('railNote')}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <SiteHeader
          user={role && profile ? { role, name: profile.fullName } : null}
          railFromLg={role === 'admin'}
          notices={user && role ? { userId: user.id, count: notices } : null}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 pb-28 lg:px-8.5 lg:pb-8.5"
        >
          {children}
        </main>
      </div>
      {role ? <BottomTabBar items={items} counts={{ providers: pending }} /> : null}
    </div>
  );
}
