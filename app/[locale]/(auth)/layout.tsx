import type { ReactNode } from 'react';

import { SkipLink } from '@/components/layout/SkipLink';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';

export const metadata = PRIVATE_PAGE_METADATA;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh w-full">
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="min-h-dvh w-full">
        {children}
      </main>
    </div>
  );
}
