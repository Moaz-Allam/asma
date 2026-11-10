import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { getPublicRegions } from '@/lib/region/public';

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const regions = await getPublicRegions();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-col px-5 lg:px-8.5">{children}</main>
      <SiteFooter whatsapp={regions[0]?.supportWhatsapp} />
    </>
  );
}
