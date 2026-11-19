'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { providerCancelJobAction } from '@/actions/jobs';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * The unlocked provider's cancel (ui-registry `CancelJobButton`, spec 0011-12 AC-6, AC-14, §36 row 9). The dialog
 * states what `cancel_preview` returned for this caller: whether the provider fee comes back (never by itself after
 * the reveal) and whether it counts against them. The action sends the request id only; Postgres decides.
 */
export function CancelJobButton({
  requestId,
  feeKept,
  countsAgainst,
}: {
  requestId: string;
  /** The matrix row keeps the provider fee (`none`): always so after the reveal. */
  feeKept: boolean;
  /** The matrix row counts this cancel against the provider. */
  countsAgainst: boolean;
}) {
  const t = useTranslations('Cancel');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof providerCancelJobAction>>;
      try {
        result = await providerCancelJobAction({ requestId });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      setOpen(false);
      if (!result.success) {
        const key = `errors.${result.error}`;
        setError(t.has(key) ? t(key as 'errors.action_failed') : t('errors.action_failed'));
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      <Button
        className="self-start"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {t('cancelJob')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('cancelJobTitle')}
        body={t('cancelJobBody')}
        confirmLabel={t('cancelJobConfirm')}
        cancelLabel={t('keep')}
        onConfirm={confirm}
        busy={busy}
      >
        <ul className="flex flex-col gap-2 rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
          <li>{t('customerTold')}</li>
          {feeKept ? <li>{t('noRefund')}</li> : null}
          {countsAgainst ? <li>{t('countsAgainst')}</li> : null}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
