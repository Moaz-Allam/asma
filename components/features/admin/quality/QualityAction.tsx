'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import { endProbationAction, handleQualityFlagAction } from '@/actions/admin-quality';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REASON_MAX, REASON_MIN, reasonLength } from '@/lib/admin-requests/constants';
import { useRouter } from '@/lib/i18n/navigation';

/**
 * Admin's quality writes with a note (ui-registry `QualityAction`, spec 0011-19a AC-5, AC-9, AC-10, AC-11): warn,
 * suspend or clear one open watchlist flag, or end one provider's probation. The dialog names the provider and the
 * figure and holds the note; its length is counted as Postgres counts it and checked there again. No figure is sent.
 */
export type QualityMode = 'warned' | 'suspended' | 'cleared' | 'end';

export function QualityAction({
  mode,
  targetId,
  provider,
  figure,
}: {
  mode: QualityMode;
  /** The flag id, or the provider id for `end`. */
  targetId: string;
  provider: string;
  /** The flag's figure in words, or the probation progress for `end`. */
  figure: string;
}) {
  const t = useTranslations('Quality.admin');
  const tReq = useTranslations('AdminRequests');
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
      let result: { success: true } | { success: false; error: string };
      try {
        result =
          mode === 'end'
            ? await endProbationAction({ providerId: targetId, note: text })
            : await handleQualityFlagAction({ flagId: targetId, outcome: mode, note: text });
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
      <Button
        variant={mode === 'suspended' ? 'destructive' : 'outline'}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {t(`actions.${mode}.label`)}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={t(`actions.${mode}.title`, { provider })}
        body={t(`actions.${mode}.body`)}
        confirmLabel={t(`actions.${mode}.confirm`)}
        cancelLabel={tReq('keep')}
        onConfirm={confirm}
        busy={busy}
      >
        <div className="flex flex-col gap-2">
          <p className="rounded-block bg-surface-secondary p-3 text-body-s text-text-primary">{figure}</p>
          <Label htmlFor={fieldId}>{t('note')}</Label>
          <Textarea
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={REASON_MAX * 2}
            aria-describedby={`${fieldId}-hint`}
            aria-invalid={error ? true : undefined}
          />
          <p id={`${fieldId}-hint`} className="text-meta text-text-secondary">
            {tReq('reasonHint', { min: REASON_MIN, max: REASON_MAX, count: length })}
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
