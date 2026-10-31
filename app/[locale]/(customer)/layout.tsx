import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/AppShell';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

export const metadata = PRIVATE_PAGE_METADATA;

export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
