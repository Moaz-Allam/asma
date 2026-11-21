'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { hideRatingAction } from '@/actions/admin-ratings';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from '@/lib/i18n/navigation';
import { HIDE_NOTE_MAX, HIDE_REASONS, type HideReason } from '@/lib/ratings/summary';

/**
 * Admin hides one rating (ui-registry `HideRatingDialog`, spec 0011-17 AC-8): the dialog names the rating's date and
 * scores first, then a reason and a note of 1 to 500 characters (counted as Postgres counts it, checked there again).
 * A hide is final and changes no score; the rating stays in admin's list.
 */
export function HideRatingDialog({ ratingId, body }: { ratingId: string; body: string }) {
  const t = useTranslations('AdminRatings');
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<HideReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const length = [...note.trim()].length;
  const valid = reason !== null && length >= 1 && length <= HIDE_NOTE_MAX;

  function confirm() {
    if (!valid || reason === null) {
      setError(t('errors.validation_failed'));
      return;
    }
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof hideRatingAction>>;
      try {
        result = await hideRatingAction({ ratingId, reason, note });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        const key = `errors.${result.error}`;
        setError(t.has(key) ? t(key as 'errors.action_failed') : t('errors.action_failed'));
        if (result.error === 'already_hidden') router.refresh();
        return;
      }
      setOpen(false);
      setNote('');
      setReason(null);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('hide')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={t('dialogTitle')}
        body={body}
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        onConfirm={confirm}
        busy={busy}
      >
        <div className="flex flex-col gap-4">
          <ChoiceChips
            name={`hide-reason-${ratingId}`}
            legend={t('reason')}
            options={HIDE_REASONS.map((value) => ({ value, label: t(`reasons.${value}`) }))}
            value={reason}
            onChange={setReason}
            disabled={busy}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId}>{t('noteLabel')}</Label>
            <Textarea
              id={fieldId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={HIDE_NOTE_MAX * 2}
              aria-describedby={`${fieldId}-hint`}
              aria-invalid={error ? true : undefined}
            />
            <p id={`${fieldId}-hint`} className="text-meta text-text-secondary">
              {t('noteHint')}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-body-s text-error-foreground">
              {error}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
