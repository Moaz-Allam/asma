'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { applyToRequest } from '@/actions/provider-feed';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { track } from '@/lib/analytics/client';
import { useRouter } from '@/lib/i18n/navigation';
import { applicationTone, codePoints, MESSAGE_MAX } from '@/lib/provider-feed/constants';
import type { OwnApplication } from '@/lib/provider-feed/schemas';
import { instantLabel } from '@/lib/requests/view';

/**
 * The apply form on `p8` (ui-registry `ApplicationForm`, spec 0009 AC-9 to AC-11): one message with a live code
 * point counter, the standing warning, and "Apply, free" behind a confirm that restates the deal. No price
 * field, no question set, no live scan. A refusal keeps the message in the field; a full or closed request
 * replaces the form with its line. A replay shows the stored status.
 */

type Shown = 'form' | 'full' | 'closed';

export function ApplicationForm({
  requestId,
  application,
  state,
  timezone,
}: {
  requestId: string;
  application: OwnApplication | null;
  state: Shown;
  timezone: string;
}) {
  const t = useTranslations('ProviderFeed');
  const locale = useLocale();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [mine, setMine] = useState<OwnApplication | null>(application);
  const [fresh, setFresh] = useState(false);
  const [shown, setShown] = useState<Shown>(state);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (mine) {
    return (
      <section
        aria-live="polite"
        className="flex flex-col gap-3 rounded-panel bg-surface-secondary p-5 lg:p-6"
      >
        <StatusChip
          tone={applicationTone(mine.status)}
          label={mine.status === 'APPLIED' ? t('feed.applied') : t(`status.${mine.status}`)}
          className="self-start"
        />
        {fresh && mine.status === 'APPLIED' ? (
          <p role="status" className="text-body font-semibold text-text-primary">
            {t('form.applied')}
          </p>
        ) : null}
        <p className="text-body-s text-text-secondary">
          {t('form.appliedOn', { date: instantLabel(mine.created_at, timezone, locale) })}
        </p>
      </section>
    );
  }

  if (shown !== 'form') {
    return (
      <p
        role="status"
        className="rounded-panel bg-surface-secondary p-5 text-body font-semibold text-text-primary"
      >
        {shown === 'full' ? t('form.full') : t('form.closed')}
      </p>
    );
  }

  function send() {
    start(async () => {
      setError(null);
      let result: Awaited<ReturnType<typeof applyToRequest>>;
      try {
        result = await applyToRequest({ requestId, applicationMessage: message });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      setConfirming(false);
      if (result.success) {
        if (!result.data.replayed) track('application_submitted', {});
        setFresh(!result.data.replayed);
        setMine(result.data.application);
        router.refresh();
        return;
      }
      if (result.error === 'request_full') {
        setShown('full');
        return;
      }
      if (result.error === 'request_closed') {
        setShown('closed');
        return;
      }
      setError(t(`errors.${result.error}` as 'errors.action_failed'));
    });
  }

  const count = codePoints(message);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-title-s text-text-primary">{t('form.title')}</h2>
      <p className="rounded-block bg-warning-light p-4 text-body-s text-warning-foreground">
        {t('form.warning')}
      </p>
      <FormField
        id="application-message"
        label={t('form.title')}
        error={error ?? undefined}
        note={<span aria-live="polite">{t('form.counter', { count, max: MESSAGE_MAX })}</span>}
      >
        <Textarea
          id="application-message"
          value={message}
          rows={5}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'application-message-error' : undefined}
          onChange={(e) => setMessage(e.target.value)}
        />
      </FormField>
      <Button size="block" disabled={pending} onClick={() => setConfirming(true)}>
        {t('form.submit')}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('form.confirmTitle')}
        body={t('form.confirmNow')}
        confirmLabel={pending ? t('form.sending') : t('form.confirmSend')}
        cancelLabel={t('form.confirmBack')}
        onConfirm={send}
        busy={pending}
      >
        <ul className="flex flex-col gap-2 rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
          <li>{t('form.confirmFree')}</li>
          <li>{t('form.confirmFee')}</li>
        </ul>
      </ConfirmDialog>
    </section>
  );
}
