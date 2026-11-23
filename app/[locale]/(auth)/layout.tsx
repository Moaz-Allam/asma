import type { ReactNode } from 'react';

import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

export const metadata = PRIVATE_PAGE_METADATA;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="min-h-svh w-full">{children}</main>;
}
