'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { payCommissionAction } from '@/actions/payments';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * Pay (ui-registry `PayButton`, spec 0011-09 AC-4, AC-10, AC-14). Sends the request id only: the database
 * charges the stored commission (rule 1). A new attempt goes to the pay page, which waits for the card page; a
 * young one is reused; a commission of 0 settles at once and the page reloads. A refusal shows its catalogue
 * string.
 */
export function PayButton({ requestId, label }: { requestId: string; label: string }) {
  const t = useTranslations('Requests');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function pay() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof payCommissionAction>>;
      try {
        result = await payCommissionAction({ requestId });
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
      if (!result.data.reused) track('payment_started', { fee: 'commission' }, { leaving: true });
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
