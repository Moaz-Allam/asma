import type { ReactNode } from 'react';

import { BottomTabBar } from '@/components/layout/BottomTabBar';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { getProfile } from '@/lib/account/profile';
import { getSessionUser } from '@/lib/auth/session';
import { menuFor } from '@/lib/navigation/menus';
import { noticeCount } from '@/lib/notifications/centre';
import { reportServerError } from '@/lib/observability/server';

/**
 * The frame of every signed in page. Layouts do not run again on client navigation, so this only draws:
 * the page's own `guardPage` is the check that holds (spec 0005 AC-12). `badge` sits in the header beside
 * the avatar: the provider's standing chip (spec 0006 AC-10). The bell's first count is read here (spec 0011-18
 * AC-8); a failed read shows no badge and is reported, never silent.
 */
export async function AppShell({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const role = user?.role ?? null;
  const count =
    user && role
      ? await noticeCount().catch((error: unknown) => {
          reportServerError('noticeCount', error);
          return null;
        })
      : null;

  return (
    <>
      <SiteHeader
        user={role && profile ? { role, name: profile.fullName } : null}
        badge={badge}
        notices={user && role ? { userId: user.id, count } : null}
      />
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 pb-28 lg:px-8.5 lg:pb-8.5"
      >
        {children}
      </main>
      {role ? <BottomTabBar items={menuFor(role)} /> : null}
    </>
  );
}
