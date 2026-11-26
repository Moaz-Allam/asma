import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { Button } from '@/components/ui/button';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { Link } from '@/lib/i18n/navigation';
import { loadReceipt } from '@/lib/requests';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';

type Props = { params: Promise<{ locale: string; feeId: string }> };

/**
 * The receipt of a paid fee (spec 0011-09 AC-13, A-6): our fee id is the receipt number; no PSP payment id. It
 * says plainly that it is not a tax invoice, until B9 decides invoicing. Payer only: an unknown id, a pending
 * fee and another payer's id are the same 404 (R-13).
 */
export default async function Page({ params }: Props) {
  const { locale, feeId } = await params;
  setRequestLocale(locale);
  // Spec 0011-10 AC-9, R-7: both payers; my_receipt keeps each to its own fees.
  const user = await guardPage(['customer', 'provider']);
  const receipt = await loadReceipt(feeId);
  if (!receipt) notFound();

  const t = await getTranslations('Payment.receipt');
  const fallback = regionDefaultLocale(user.region ?? 'TR');
  const rows: { term: string; value: ReactNode }[] = [
    { term: t('number'), value: <span className="break-all">{receipt.receipt_number}</span> },
    { term: t('kind'), value: t(`kinds.${receipt.kind}`) },
    { term: t('amount'), value: <MoneyDisplay amount={receipt.amount} currency={receipt.currency} /> },
    { term: t('status'), value: t(`statuses.${receipt.status}`) },
    { term: t('paidAt'), value: instantLabel(receipt.paid_at, receipt.timezone, locale) },
    { term: t('service'), value: localized(receipt.service_name, locale, fallback) },
    { term: t('date'), value: instantLabel(receipt.scheduled_start_at, receipt.timezone, locale) },
  ];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <h1 className="font-display text-title text-text-primary">{t('title')}</h1>
      <dl className="divide-y-2 divide-border-light rounded-panel border-2 border-border bg-surface">
        {rows.map((row) => (
          <div key={row.term} className="grid gap-1 px-5 py-4 sm:grid-cols-[1fr_2fr]">
            <dt className="text-body-s text-text-secondary">{row.term}</dt>
            <dd className="text-body-s font-semibold break-words text-text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
        {t('notInvoice')}
      </p>
      <Button asChild variant="outline" className="self-start">
        <Link
          href={
            receipt.kind === 'commission'
              ? `/requests/${receipt.request_id}`
              : receipt.status === 'paid'
                ? '/provider/applications?tab=active'
                : '/provider/applications?tab=done'
          }
        >
          {receipt.kind === 'commission' ? t('toRequest') : t('toJobs')}
        </Link>
      </Button>
    </div>
  );
}
