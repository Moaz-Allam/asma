'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { payCommissionAction, payProviderFeeAction } from '@/actions/payments';
import { AgreementCheckbox } from '@/components/features/agreements/AgreementCheckbox';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * What Pay pays: the customer's commission on a request, or the chosen provider's fee on its application, with the
 * service agreement version the payer accepts (spec 0011-20 AC-2, AC-3).
 */
export type PayTarget =
  | { kind: 'commission'; requestId: string; agreementVersion: string }
  | { kind: 'provider_fee'; applicationId: string; agreementVersion: string };

/**
 * Pay (ui-registry `PayButton`, spec 0011-09 AC-4, AC-10, AC-14; spec 0011-10 AC-8, AC-10; spec 0011-20 AC-2, AC-3).
 * Above it the required agreement tick; the button stays disabled until it is ticked. Sends an id and the version
 * only: the database charges the stored amount (rule 1) and stores the acceptance in the same transaction. A new
 * attempt goes to the pay page, which waits for the card page; a young one is reused; a fee of 0 settles at once and
 * the page reloads. A refusal shows its catalogue string.
 */
export function PayButton({ target, label }: { target: PayTarget; label: string }) {
  const t = useTranslations('Requests');
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusedAgreement, setRefusedAgreement] = useState(false);
  const [busy, start] = useTransition();

  function pay() {
    if (!accepted) return;
    setError(null);
    setRefusedAgreement(false);
    start(async () => {
      let result: Awaited<ReturnType<typeof payCommissionAction>>;
      try {
        result =
          target.kind === 'commission'
            ? await payCommissionAction({
                requestId: target.requestId,
                agreementVersion: target.agreementVersion,
              })
            : await payProviderFeeAction({
                applicationId: target.applicationId,
                agreementVersion: target.agreementVersion,
              });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        if (result.error === 'agreement_required') {
          // The version changed under the page: untick, so the payer reads the current one before paying.
          setAccepted(false);
          setRefusedAgreement(true);
        }
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
      <AgreementCheckbox
        version={target.agreementVersion}
        checked={accepted}
        onCheckedChange={(value) => {
          setAccepted(value);
          if (value) setRefusedAgreement(false);
        }}
        showError={refusedAgreement}
      />
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      <Button
        className="self-start"
        disabled={busy || !accepted}

        onClick={pay}
      >
        {label}
      </Button>
    </div>
  );
}
