import { setRequestLocale } from 'next-intl/server';

import { ReportScreen } from '@/components/features/reports/ReportScreen';
import { guardPage } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; requestId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The chosen provider reports a problem on a job (spec 0011-14 AC-1, AC-7). */
export default async function Page({ params, searchParams }: Props) {
  const { locale, requestId } = await params;
  setRequestLocale(locale);
  await guardPage(['provider']);
  const query = await searchParams;
  return (
    <ReportScreen requestId={requestId} backHref="/provider/applications?tab=active" reason={query.reason} />
  );
}
