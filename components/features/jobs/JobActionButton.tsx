'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { confirmJobAction, finishJobAction, markJobDoneAction, startJobAction } from '@/actions/jobs';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { useRouter } from '@/lib/i18n/navigation';

export type JobMove = 'start' | 'finish' | 'confirm' | 'mark_done';

const ACTIONS = {
  start: startJobAction,
  finish: finishJobAction,
  confirm: confirmJobAction,
  mark_done: markJobDoneAction,
} as const;

/**
 * Started, Done, Confirm and "Job done" (ui-registry `JobActionButton`, spec 0011-11 AC-7, AC-8). Each opens the
 * `ConfirmDialog`, sends the request id only, and refreshes the page; Postgres decides whether the move is allowed
 * (the start day, the state, the caller). A refusal shows its catalogue string. No money moves (D91).
 */
export function JobActionButton({
  move,
  requestId,
  label,
  title,
  body,
  variant = 'primary',
}: {
  move: JobMove;
  requestId: string;
  label: string;
  title: string;
  body: string;
  variant?: 'primary' | 'secondary' | 'outline';
}) {
  const t = useTranslations('Jobs');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof startJobAction>>;
      try {
        result = await ACTIONS[move]({ requestId });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      setOpen(false);
      if (!result.success) {
        setError(t(`errors.${result.error}` as 'errors.action_failed'));
        router.refresh();
        return;
      }
      if (!result.data.replayed) {
        if (move === 'start') track('job_started', {});
        else if (move === 'finish') track('job_done', {});
        else track('job_confirmed', { by: move });
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
      <Button className="self-start" variant={variant} disabled={busy} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        body={body}
        confirmLabel={label}
        cancelLabel={t('cancel')}
        onConfirm={confirm}
        busy={busy}
      />
    </div>
  );
}
