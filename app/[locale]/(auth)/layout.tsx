import type { ReactNode } from 'react';

import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

export const metadata = PRIVATE_PAGE_METADATA;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto min-h-svh w-full max-w-7xl p-5 lg:px-8.5 lg:pt-6.5">{children}</main>;
}
