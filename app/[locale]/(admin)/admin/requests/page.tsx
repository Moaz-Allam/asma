import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { requestIdFrom } from '@/lib/admin-requests/constants';
import { guardPage } from '@/lib/auth/session';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The target of the admin home's "Find request by id" field (spec 0011-12 AC-12): a valid id goes to its page, anything
 * else back home with `?find=invalid`. Admin only; the id is checked again by the detail page's query.
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const raw = (await searchParams).id;
  const id = typeof raw === 'string' ? requestIdFrom(raw) : null;
  redirect(id ? `/${locale}/admin/requests/${id}` : `/${locale}/admin?find=invalid`);
}
