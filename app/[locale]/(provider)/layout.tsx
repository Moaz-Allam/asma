import { reportServerError } from '@/lib/observability/server';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/AppShell';
import { StandingChip } from '@/components/features/provider/StandingChip';
import { UserWarning } from '@/components/features/reports/UserWarning';
import { getSessionUser } from '@/lib/auth/session';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';
import { getStanding } from '@/lib/provider/queries';

export const metadata = PRIVATE_PAGE_METADATA;

/**
 * Reads the provider's standing once per request for the header chip (spec 0006 AC-10). Every action that
 * changes it calls `revalidatePath('/', 'layout')`. The page's own `guardPage` is the check that holds.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  // A failed read shows no chip (the page shows its own ErrorState), but it is reported, never silent.
  const standing =
    user?.role === 'provider'
      ? await getStanding(user.id).catch((error: unknown) => {
          reportServerError('providerLayout', error);
          return null;
        })
      : null;
  // Spec 0011-14 AC-6: a warning from admin shows on every page of the area until acknowledged.
  return (
    <AppShell
      approvedProvider={standing === 'approved'}
      badge={standing && standing !== 'approved' ? <StandingChip standing={standing} /> : null}
    >
      <UserWarning />
      {children}
    </AppShell>
  );
}
