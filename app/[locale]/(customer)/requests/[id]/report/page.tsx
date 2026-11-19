import { setRequestLocale } from 'next-intl/server';

import { ReportScreen } from '@/components/features/reports/ReportScreen';
import { guardPage } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The customer reports a problem on one of their requests (spec 0011-14 AC-1, AC-3, AC-7). */
export default async function Page({ params, searchParams }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await guardPage(['customer']);
  const query = await searchParams;
  return <ReportScreen requestId={id} backHref={`/requests/${id}`} reason={query.reason} />;
}
