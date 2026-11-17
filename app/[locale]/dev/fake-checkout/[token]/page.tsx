import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { PRIVATE_PAGE_METADATA } from '@/lib/navigation/menus';
import { FAKE_CHOICES, isFakeOutcome, readFakeCheckout } from '@/lib/relay/fake-checkout';

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ chosen?: string }>;
};

export const metadata = PRIVATE_PAGE_METADATA;

/**
 * The fake card page (spec 0011-08 AC-15). Dev only: a 404 unless PSP_DRIVER=fake and the deployment is not
 * production. It stands in for iyzico's page: pick an outcome, then go back to the shop, which posts the real
 * callback form. The webhook only outcome sends a signed webhook instead, so there is no way back from here.
 */
export default async function FakeCheckoutPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const checkout = readFakeCheckout(decodeURIComponent(token));
  if (checkout === null) notFound();
  const { chosen } = await searchParams;
  const t = await getTranslations('DevFakeCheckout');
  const amount = formatMoney(checkout.amount, checkout.currency, locale as Locale);

  return (
    // No site header or footer (a stand in for the PSP's own page), but the public layout's gutter and width.
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6.5 lg:px-8.5">
      <PageHeader title={t('title')} />
      <p className="text-body text-text-secondary">{t('amount', { amount })}</p>

      {isFakeOutcome(chosen) ? (
        <section className="flex flex-col gap-4">
          <p className="text-body text-text-primary" role="status">
            {t('chosen', { outcome: t(`outcomes.${chosen}`) })}
          </p>
          {chosen === 'webhook_only' ? (
            <p className="text-body text-text-secondary">{t('webhookSent')}</p>
          ) : (
            <form method="post" action="/api/psp/callback">
              <input type="hidden" name="token" value={checkout.token} />
              <Button type="submit" size="block">
                {t('returnToShop')}
              </Button>
            </form>
          )}
        </section>
      ) : (
        <form method="post" action="/api/psp/fake-checkout" className="flex flex-col gap-3">
          <input type="hidden" name="token" value={checkout.token} />
          <input type="hidden" name="locale" value={locale} />
          <p className="text-body text-text-primary">{t('choose')}</p>
          {FAKE_CHOICES.map((outcome) => (
            <Button key={outcome} type="submit" name="outcome" value={outcome} variant="outline" size="block">
              {t(`outcomes.${outcome}`)}
            </Button>
          ))}
        </form>
      )}
    </main>
  );
}
