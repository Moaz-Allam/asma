'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { withdrawApplicationAction } from '@/actions/jobs';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * Withdraw on My jobs (ui-registry `WithdrawButton`, spec 0011-12 AC-5, AC-14): Applied and Chosen, before the
 * reveal. The dialog says what follows from the application's status (§36 rows 3 and 6); the action sends the
 * application id only, and Postgres decides. A refusal shows its catalogue string and the page reloads.
 */
export function WithdrawButton({
  applicationId,
  status,
}: {
  applicationId: string;
  status: 'APPLIED' | 'SELECTED' | 'AWAITING_FEE';
}) {
  const t = useTranslations('Cancel');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof withdrawApplicationAction>>;
      try {
        result = await withdrawApplicationAction({ applicationId });
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
        {t('withdraw')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('withdrawTitle')}
        body={t(`withdrawBody.${status}`)}
        confirmLabel={t('withdrawConfirm')}
        cancelLabel={t('keep')}
        onConfirm={confirm}
        busy={busy}
      />
    </div>
  );
}
