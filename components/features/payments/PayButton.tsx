'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { payCommissionAction, payProviderFeeAction } from '@/actions/payments';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { useRouter } from '@/lib/i18n/navigation';

/** What Pay pays: the customer's commission on a request, or the chosen provider's fee on its application. */
export type PayTarget =
  { kind: 'commission'; requestId: string } | { kind: 'provider_fee'; applicationId: string };

/**
 * Pay (ui-registry `PayButton`, spec 0011-09 AC-4, AC-10, AC-14; spec 0011-10 AC-8, AC-10). Sends an id only:
 * the database charges the stored amount (rule 1). A new attempt goes to the pay page, which waits for the card
 * page; a young one is reused; a fee of 0 settles at once and the page reloads. A refusal shows its catalogue
 * string.
 */
export function PayButton({ target, label }: { target: PayTarget; label: string }) {
  const t = useTranslations('Requests');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function pay() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof payCommissionAction>>;
      try {
        result =
          target.kind === 'commission'
            ? await payCommissionAction({ requestId: target.requestId })
            : await payProviderFeeAction({ applicationId: target.applicationId });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        setError(t(`errors.${result.error}` as 'errors.action_failed'));
        router.refresh();
        return;
      }
      if (result.data.status === 'settled') {
        router.refresh();
        return;
      }
      if (!result.data.reused) track('payment_started', { fee: target.kind }, { leaving: true });
      router.push(`/pay/${result.data.attemptId}`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      <Button className="self-start" disabled={busy} onClick={pay}>
        {label}
      </Button>
    </div>
  );
}
