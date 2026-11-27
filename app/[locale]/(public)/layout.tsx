import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SkipLink } from '@/components/layout/SkipLink';
import { getPublicRegions } from '@/lib/region/public';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const regions = await getPublicRegions();

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 lg:px-8.5"
      >
        {children}
      </main>
      <SiteFooter whatsapp={regions[0]?.supportWhatsapp} />
    </div>
  );
}
