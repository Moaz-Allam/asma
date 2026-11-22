'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { acknowledgeWarningAction } from '@/actions/reports';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/lib/i18n/navigation';
import type { WarningReason } from '@/lib/reports/constants';

/**
 * A warning from admin (ui-registry `WarningBanner`, spec 0011-14 AC-6, R-9): a fixed sentence per reason code in
 * the reader's language, never admin's words, on every page of the customer's or the provider's area until they
 * press "I understand".
 */
export function WarningBanner({ warningId, reason }: { warningId: string; reason: WarningReason }) {
  const t = useTranslations('Reports');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function acknowledge() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof acknowledgeWarningAction>>;
      try {
        result = await acknowledgeWarningAction({ warningId });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) setError(t(`errors.${result.error}` as 'errors.action_failed'));
      router.refresh();
    });
  }

  return (
    <section
      role="alert"
      aria-labelledby="warning-title"
      className="flex flex-col gap-3 rounded-panel bg-warning-light p-5 text-warning-foreground lg:p-7.5"
    >
      <h2 id="warning-title" className="font-display text-title-s">
        {t('banner.title')}
      </h2>
      <p className="text-body">{t(`warning.${reason}`)}</p>
      {error ? <p className="text-body-s">{error}</p> : null}
      <Button className="self-start" variant="white" disabled={busy} onClick={acknowledge}>
        {t('banner.acknowledge')}
      </Button>
    </section>
  );
}
