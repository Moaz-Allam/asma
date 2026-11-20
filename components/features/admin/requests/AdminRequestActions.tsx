'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition, type ReactNode } from 'react';

import {
  adminCancelRequestAction,
  adminExtendDeadlineAction,
  adminShowAddressAction,
} from '@/actions/admin-requests';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CANCEL_ATTRIBUTIONS,
  EXTEND_HOURS_MAX,
  EXTEND_HOURS_MIN,
  REASON_MAX,
  REASON_MIN,
  reasonLength,
  type CancelAttribution,
  type ExtendWhich,
} from '@/lib/admin-requests/constants';
import { formatMoney } from '@/lib/format/money';
import type { Locale } from '@/lib/i18n/direction';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * Admin's operations on one request (ui-registry `AdminRequestActions`, spec 0011-16 R-3, R-5, R-8): cancel with an
 * attribution, extend the one deadline the state allows, and show the street line. Each dialog holds a reason,
 * counted as Postgres counts it and checked there again. No amount is ever sent. The street line lives only in this
 * component's state after the Server Action returns it; the page never renders it.
 */

type Result = { success: true; data: unknown } | { success: false; error: string };

function useReasonDialog() {
  const t = useTranslations('AdminRequests');
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const length = reasonLength(text);
  const valid = length >= REASON_MIN && length <= REASON_MAX;

  function run(call: () => Promise<Result>, done: (data: unknown) => void) {
    if (!valid) {
      setError(t('errors.reason_required'));
      return;
    }
    setError(null);
    start(async () => {
      let result: Result;
      try {
        result = await call();
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
      done(result.data);
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  const field = (label: string): ReactNode => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId}>{label}</Label>
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
  );

  return { t, open, setOpen, onOpenChange, text, busy, run, field };
}

/** R-3, AC-2: cancel as admin. The dialog lists every paid fee and links to the fees section to refund each. */
export function AdminCancelAction({
  requestId,
  paidFees,
}: {
  requestId: string;
  paidFees: ReadonlyArray<{
    id: string;
    kind: 'commission' | 'provider_fee';
    amount: number;
    currency: 'TRY' | 'SAR';
  }>;
}) {
  const dialog = useReasonDialog();
  const { t } = dialog;
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [attributedTo, setAttributedTo] = useState<CancelAttribution>('platform');

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" onClick={() => dialog.setOpen(true)}>
        {t('cancel')}
      </Button>
      <ConfirmDialog
        open={dialog.open}
        onOpenChange={dialog.onOpenChange}
        title={t('cancelTitle')}
        body={t('cancelBody')}
        confirmLabel={t('cancelConfirm')}
        cancelLabel={t('keep')}
        busy={dialog.busy}
        onConfirm={() =>
          dialog.run(
            () => adminCancelRequestAction({ requestId, attributedTo, reason: dialog.text }),
            () => router.refresh(),
          )
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-body-s font-bold text-text-primary">{t('cancelPaid')}</p>
            {paidFees.length === 0 ? (
              <p className="text-body-s text-text-secondary">{t('cancelNoPaid')}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {paidFees.map((fee) => (
                    <li key={fee.id} className="text-body-s text-text-primary">
                      {t(`kind.${fee.kind}`)} · {formatMoney(fee.amount, fee.currency, locale)}
                    </li>
                  ))}
                </ul>
                <a
                  href="#req-fees"
                  onClick={() => dialog.setOpen(false)}
                  className="inline-flex min-h-11 items-center text-body-s text-link underline"
                >
                  {t('cancelRefundLink')}
                </a>
              </>
            )}
          </div>
          <ChoiceChips
            name={`attribution-${requestId}`}
            legend={t('attributedTo')}
            options={CANCEL_ATTRIBUTIONS.map((value) => ({ value, label: t(`attribution.${value}`) }))}
            value={attributedTo}
            onChange={setAttributedTo}
            disabled={dialog.busy}
          />
          {dialog.field(t('reason'))}
        </div>
      </ConfirmDialog>
    </div>
  );
}

/** R-5, AC-3: extend the one deadline the request's state allows, once, by 1 to 48 hours. */
export function AdminExtendAction({
  requestId,
  which,
  deadlineLabel,
}: {
  requestId: string;
  which: ExtendWhich;
  /** The current deadline, already formatted in the request's time zone. */
  deadlineLabel: string;
}) {
  const dialog = useReasonDialog();
  const { t } = dialog;
  const router = useRouter();
  const hoursId = useId();
  const [hours, setHours] = useState('24');
  const parsed = Number.parseInt(hours, 10);
  const hoursValid = Number.isInteger(parsed) && parsed >= EXTEND_HOURS_MIN && parsed <= EXTEND_HOURS_MAX;

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" onClick={() => dialog.setOpen(true)}>
        {t('extend')}
      </Button>
      <ConfirmDialog
        open={dialog.open}
        onOpenChange={dialog.onOpenChange}
        title={t('extendTitle')}
        body={t('extendBody', { which: t(`which.${which}`), deadline: deadlineLabel })}
        confirmLabel={t('extendConfirm')}
        cancelLabel={t('keep')}
        busy={dialog.busy}
        onConfirm={() =>
          hoursValid
            ? dialog.run(
                () => adminExtendDeadlineAction({ requestId, which, hours: parsed, reason: dialog.text }),
                () => router.refresh(),
              )
            : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={hoursId}>{t('hours')}</Label>
            <Input
              id={hoursId}
              type="number"
              inputMode="numeric"
              min={EXTEND_HOURS_MIN}
              max={EXTEND_HOURS_MAX}
              step={1}
              dir="ltr"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              aria-invalid={hoursValid ? undefined : true}
              aria-describedby={`${hoursId}-hint`}
            />
            <p
              id={`${hoursId}-hint`}
              role={hoursValid ? undefined : 'alert'}
              className={hoursValid ? 'text-meta text-text-secondary' : 'text-body-s text-error-foreground'}
            >
              {t('hoursHint', { min: EXTEND_HOURS_MIN, max: EXTEND_HOURS_MAX })}
            </p>
          </div>
          {dialog.field(t('reason'))}
        </div>
      </ConfirmDialog>
    </div>
  );
}

/** R-8, X-13, AC-5: the street line on click, with a reason; audited in Postgres, held only here. */
export function AdminAddressButton({ requestId }: { requestId: string }) {
  const dialog = useReasonDialog();
  const { t } = dialog;
  const [line, setLine] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {line ? (
        <p className="flex flex-col gap-1 rounded-block bg-surface p-3" role="status">
          <span className="text-meta text-text-secondary">{t('addressLine')}</span>
          <span className="text-body-s text-text-primary" dir="auto">
            {line}
          </span>
        </p>
      ) : (
        <Button variant="outline" size="sm" onClick={() => dialog.setOpen(true)}>
          {t('address')}
        </Button>
      )}
      <ConfirmDialog
        open={dialog.open}
        onOpenChange={dialog.onOpenChange}
        title={t('addressTitle')}
        body={t('addressBody')}
        confirmLabel={t('addressConfirm')}
        cancelLabel={t('keep')}
        busy={dialog.busy}
        onConfirm={() =>
          dialog.run(
            () => adminShowAddressAction({ requestId, reason: dialog.text }),
            (data) => setLine((data as { line: string }).line),
          )
        }
      >
        {dialog.field(t('reason'))}
      </ConfirmDialog>
    </div>
  );
}
