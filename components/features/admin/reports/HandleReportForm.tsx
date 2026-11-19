'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { handleReportAction } from '@/actions/admin-reports';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { track } from '@/lib/analytics/client';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { useRouter } from '@/lib/i18n/navigation';
import {
  NOTE_MAX,
  NOTE_MIN,
  REPORT_REASONS,
  reportTextLength,
  type ReportOutcome,
  type ReportReason,
} from '@/lib/reports/constants';

/** A paid fee of the report's request that can still be refunded, as the dialog names it (X-20). */
export type RefundableFee = {
  id: string;
  kind: 'commission' | 'provider_fee';
  payer: 'customer' | 'provider';
  amount: number;
  currency: 'TRY' | 'SAR';
};

/**
 * Admin handles a report once (ui-registry `HandleReportForm`, spec 0011-14 AC-5, R-9 to R-12, X-19, X-20): an
 * outcome among those that fit, the warning reason for a warning or a suspension, a note only admin reads, and an
 * optional refund of one of the request's own paid fees, named with its payer and amount. A confirm dialog first;
 * Postgres decides everything again.
 */
export function HandleReportForm({
  reportId,
  outcomes,
  defaultReason,
  fees,
}: {
  reportId: string;
  /** The outcomes that fit this report and its job now; Postgres refuses the rest anyway. */
  outcomes: readonly ReportOutcome[];
  defaultReason: ReportReason;
  fees: readonly RefundableFee[];
}) {
  const t = useTranslations('AdminReports');
  const tReasons = useTranslations('Reports.reasons');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const noteId = useId();
  const refundId = useId();
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  const [reason, setReason] = useState<ReportReason>(defaultReason);
  const [note, setNote] = useState('');
  const [refund, setRefund] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const length = reportTextLength(note);
  const ready = outcome !== null && length >= NOTE_MIN && length <= NOTE_MAX;
  const needsReason = outcome === 'warned' || outcome === 'suspended';

  function save() {
    if (!outcome) return;
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof handleReportAction>>;
      try {
        result = await handleReportAction({
          reportId,
          outcome,
          note,
          refundPaymentId: refund === '' ? null : refund,
          warningReason: needsReason ? reason : null,
        });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      setOpen(false);
      if (!result.success) {
        setError(t(`errors.${result.error}` as 'errors.action_failed'));
      } else {
        track('report_handled', { outcome });
      }
      router.refresh();
    });
  }

  return (
    <form
      aria-labelledby="handle-title"
      className="flex flex-col gap-5 rounded-panel border border-border-light bg-surface p-5 lg:p-7.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) setOpen(true);
      }}
    >
      <h2 id="handle-title" className="font-display text-title-s text-text-primary">
        {t('handleTitle')}
      </h2>
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      <ChoiceChips
        name="report-outcome"
        legend={t('outcome')}
        options={outcomes.map((value) => ({ value, label: t(`outcomes.${value}`) }))}
        value={outcome}
        onChange={setOutcome}
        disabled={busy}
      />
      {needsReason ? (
        <ChoiceChips
          name="warning-reason"
          legend={t('warningReason')}
          options={REPORT_REASONS.map((value) => ({ value, label: tReasons(value) }))}
          value={reason}
          onChange={setReason}
          disabled={busy}
        />
      ) : null}
      <FormField id={noteId} label={t('noteLabel')} note={`${length} / ${NOTE_MAX}`}>
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          maxLength={NOTE_MAX + 50}
          disabled={busy}
          required
        />
      </FormField>
      {fees.length > 0 ? (
        <FormField id={refundId} label={t('refund')}>
          <select
            id={refundId}
            value={refund}
            onChange={(event) => setRefund(event.target.value)}
            disabled={busy}
            className="min-h-11 rounded-block border border-border-light bg-surface px-4 text-body-s text-text-primary"
          >
            <option value="">{t('noRefund')}</option>
            {fees.map((fee) => (
              <option key={fee.id} value={fee.id}>
                {t('refundOption', {
                  kind: t(`kinds.${fee.kind}`),
                  payer: t(`payers.${fee.payer}`),
                  amount: formatMoney(fee.amount, fee.currency, locale),
                })}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}
      <Button type="submit" className="self-start" disabled={!ready || busy}>
        {t('submit')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('confirmTitle')}
        body={t('confirmBody')}
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        onConfirm={save}
        busy={busy}
      >
        {outcome ? (
          <p className="text-body-s font-semibold text-text-primary">{t(`outcomes.${outcome}`)}</p>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}
