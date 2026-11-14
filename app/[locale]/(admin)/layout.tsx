import type { ReactNode } from 'react';

import { AdminShell } from '@/components/features/admin/AdminShell';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

export const metadata = PRIVATE_PAGE_METADATA;

export default function Layout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
