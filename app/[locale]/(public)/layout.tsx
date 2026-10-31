import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/layout/SiteHeader';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6.5 lg:px-8.5">{children}</main>
    </>
  );
}
