'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { cancelRequestAction } from '@/actions/requests';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { CANCEL_REASONS, type CancelReason } from '@/lib/requests/input';

/**
 * The detail page's actions (spec 0008 AC-14, AC-15, `s14` row 1): Cancel while OPEN, expired included,
 * through a `ConfirmDialog` that says nothing was paid and nothing comes back, with optional reason chips;
 * and Repeat unless the request is live OPEN (D56). A refusal shows its catalogue string and the page reloads.
 */
export function RequestActions({
  requestId,
  canCancel,
  canRepeat,
}: {
  requestId: string;
  canCancel: boolean;
  canRepeat: boolean;
}) {
  const t = useTranslations('Requests');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await cancelRequestAction({ requestId, reason });
      if (!result.success) setError(t(`errors.${result.error}` as 'errors.action_failed'));
      setOpen(false);
      router.refresh();
    });
  }

  if (!canCancel && !canRepeat) return null;
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {canRepeat ? (
          <Button asChild>
            <Link href={`/requests/new?from=${requestId}`}>{t('detail.repeat')}</Link>
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t('detail.cancel')}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('cancel.title')}
        body={t('cancel.body')}
        confirmLabel={t('cancel.confirm')}
        cancelLabel={t('cancel.keep')}
        onConfirm={confirm}
        busy={busy}
      >
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
