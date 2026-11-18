'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { cancelRequestAction } from '@/actions/requests';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { CANCEL_REASONS, type CancelReason } from '@/lib/requests/constants';

/** What `cancel_preview` said for the customer (spec 0011-12 AC-14): the matrix outcome and the exact refund. */
export type CancelOffer = {
  outcome: 'not_paid' | 'refund' | 'carry' | 'none' | 'by_hand' | null;
  refund: { amount: number; currency: 'TRY' | 'SAR' } | null;
};

/**
 * The detail page's actions (spec 0008 AC-14, AC-15, `s14` row 1; spec 0011-12 AC-6, AC-14): Cancel whenever the
 * matrix allows it, through a `ConfirmDialog` that states what `cancel_preview` returned (nothing was paid, the
 * exact commission that comes back, or nothing back after the reveal), with optional reason chips; and Repeat
 * unless the request is live OPEN (D56), worded "Post again" after a provider's cancel. A refusal shows its
 * catalogue string and the page reloads; a refund queued is confirmed with its amount.
 */
export function RequestActions({
  requestId,
  cancel,
  canRepeat,
  repeatLabel = null,
  chosenNote = null,
}: {
  requestId: string;
  /** Null when the customer may not cancel now. */
  cancel: CancelOffer | null;
  canRepeat: boolean;
  /** Spec 0011-12 AC-14: "Post again" after the provider cancelled. */
  repeatLabel?: string | null;
  /** Spec 0010 AC-11: in SELECTED, the dialog says the chosen provider's offer is cancelled. */
  chosenNote?: string | null;
}) {
  const t = useTranslations('Requests');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof cancelRequestAction>>;
      try {
        result = await cancelRequestAction({ requestId, reason });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (result.success) {
        const refund = result.data.refund;
        setError(null);
        setDone(
          refund
            ? t('cancel.refunded', { amount: formatMoney(refund.amount, refund.currency, locale) })
            : null,
        );
      } else {
        setError(t(`errors.${result.error}` as 'errors.action_failed'));
      }
      setOpen(false);
      router.refresh();
    });
  }

  const body = cancel?.refund
    ? t('cancel.bodyRefund', { amount: formatMoney(cancel.refund.amount, cancel.refund.currency, locale) })
    : cancel?.outcome === 'none'
      ? t('cancel.bodyNoRefund')
      : t('cancel.body');

  if (!cancel && !canRepeat && !done) return null;
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="rounded-block bg-success-light p-4 text-body-s text-success-foreground">
          {done}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {canRepeat ? (
          <Button asChild>
            <Link href={`/requests/new?from=${requestId}`}>{repeatLabel ?? t('detail.repeat')}</Link>
          </Button>
        ) : null}
        {cancel ? (
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            {t('detail.cancel')}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('cancel.title')}
        body={body}
        confirmLabel={t('cancel.confirm')}
        cancelLabel={t('cancel.keep')}
        onConfirm={confirm}
        busy={busy}
      >
        {chosenNote ? <p className="text-body-s text-text-primary">{chosenNote}</p> : null}
        <ChoiceChips
          name="cancel-reason"
          legend={t('cancel.reason')}
          options={CANCEL_REASONS.map((value) => ({ value, label: t(`cancel.reasons.${value}`) }))}
          value={reason}
          onChange={setReason}
        />
      </ConfirmDialog>
    </div>
  );
}
