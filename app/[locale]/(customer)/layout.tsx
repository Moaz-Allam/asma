import type { ReactNode } from 'react';

import { UserWarning } from '@/components/features/reports/UserWarning';
import { AppShell } from '@/components/layout/AppShell';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

export const metadata = PRIVATE_PAGE_METADATA;

export default function Layout({ children }: { children: ReactNode }) {
  // Spec 0011-14 AC-6: a warning from admin shows on every page of the area until acknowledged.
  return (
    <AppShell>
      <UserWarning />
      {children}
    </AppShell>
  );
}
