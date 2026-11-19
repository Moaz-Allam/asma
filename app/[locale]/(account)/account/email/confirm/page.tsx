import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ConfirmEmailForm } from '@/components/features/account/ConfirmEmailForm';
import { PageHeader } from '@/components/shared/PageHeader';
import { guardPage } from '@/lib/auth/session';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Spec 0011-13 AC-7: the link from `confirm_email`. Signed in only: proxy.ts sends a signed out visitor to the
 * login with this path, token included, as `next`, and 01's login brings them back. The page itself changes
 * nothing; its one button posts `confirmEmail`. The scrubber drops `t` from every URL it reports (D85).
 */
export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await guardPage('any');
  const query = await searchParams;
  const raw = query.t;
  const token = typeof raw === 'string' && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
  const t = await getTranslations('Account');

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title={t('confirm.title')} intro={t('confirm.intro')} />
      <ConfirmEmailForm token={token} />
    </div>
  );
}
