'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import {
  adminClearFlagAction,
  adminMarkRefundDoneAction,
  adminRefundFeeAction,
} from '@/actions/admin-requests';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REASON_MAX, REASON_MIN, reasonLength } from '@/lib/admin-requests/constants';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * Admin's writes with a reason (ui-registry `AdminReasonAction`, spec 0011-12 AC-8, AC-9; spec 0011-16 R-7): refund
 * a paid fee by hand with a reason, record a refused refund as refunded by hand in the PSP panel with a note, or
 * clear an open deadline flag with a note.
 * The dialog states the exact amount and holds the text field; the length is counted as Postgres counts it and
 * checked there again. The amount is shown, never sent: the refund is the paid fee's own.
 */
export function AdminReasonAction({
  mode,
  targetId,
  label,
  amount,
  currency,
}: {
  mode: 'refund' | 'done' | 'clear';
  /** The fee id for `refund`, the refund id for `done`, the flag id for `clear`. */
  targetId: string;
  label: string;
  /** The fee's or the refund's own amount, shown in the dialog (review of 12); none for `clear`. */
  amount?: number;
  currency?: 'TRY' | 'SAR';
}) {
  const t = useTranslations('AdminRequests');
  const tFlags = useTranslations('AdminFlags');
  const locale = useLocale() as Locale;
  const money = amount !== undefined && currency ? formatMoney(amount, currency, locale) : '';
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const length = reasonLength(text);
  const valid = length >= REASON_MIN && length <= REASON_MAX;

  function confirm() {
    if (!valid) {
      setError(t('errors.reason_required'));
      return;
    }
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof adminRefundFeeAction>>;
      try {
        result =
          mode === 'refund'
            ? await adminRefundFeeAction({ paymentId: targetId, reason: text })
            : mode === 'done'
              ? await adminMarkRefundDoneAction({ refundId: targetId, note: text })
              : await adminClearFlagAction({ flagId: targetId, note: text });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        const key = `errors.${result.error}`;
        setError(t.has(key) ? t(key as 'errors.action_failed') : t('errors.action_failed'));
        return;
      }
      setOpen(false);
      setText('');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={mode === 'refund' ? t('refundTitle') : mode === 'done' ? t('doneTitle') : tFlags('clearTitle')}
        body={
          mode === 'refund'
            ? t('refundBody', { amount: money })
            : mode === 'done'
              ? t('doneBody', { amount: money })
              : tFlags('clearBody')
        }
        confirmLabel={
          mode === 'refund' ? t('refundConfirm') : mode === 'done' ? t('doneConfirm') : tFlags('clearConfirm')
        }
        cancelLabel={t('keep')}
        onConfirm={confirm}
        busy={busy}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={fieldId}>
            {mode === 'refund' ? t('reason') : mode === 'done' ? t('note') : tFlags('note')}
          </Label>
          <Textarea
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={REASON_MAX * 2}
            aria-describedby={`${fieldId}-hint`}
            aria-invalid={error ? true : undefined}
          />
          <p id={`${fieldId}-hint`} className="text-meta text-text-secondary">
            {t('reasonHint', { min: REASON_MIN, max: REASON_MAX, count: length })}
          </p>
          {error ? (
            <p role="alert" className="text-body-s text-error-foreground">
              {error}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
