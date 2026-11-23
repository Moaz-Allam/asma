import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { CheckoutWaiter } from '@/components/features/payments/CheckoutWaiter';
import { guardPage } from '@/lib/auth/session';
import { loadCheckoutPage } from '@/lib/requests/checkout-page';

type Props = { params: Promise<{ locale: string; attemptId: string }> };

/**
 * The return page (spec 0011-09 AC-12, A-3): the callback lands here and the page waits for the relay's verified
 * result; the redirect itself never shows a paid state. Payer only: an unknown id and another payer's id are the
 * same 404 (R-13).
 */
export default async function Page({ params }: Props) {
  const { locale, attemptId } = await params;
  setRequestLocale(locale);
  // Spec 0011-10 AC-9, R-7: both payers; my_checkout keeps each to its own attempts.
  await guardPage(['customer', 'provider']);
  const page = await loadCheckoutPage(attemptId);
  if (!page) notFound();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <CheckoutWaiter
        mode="return"
        initial={page.status}
        receiptHref={page.receiptHref}
        canRetry={page.canRetry}
        agreementVersion={page.agreementVersion}
      />
    </div>
  );
}
