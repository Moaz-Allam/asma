'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { setNotificationPreference } from '@/actions/account';
import { Switch } from '@/components/ui/switch';
import type { NoticeRow, Topic } from '@/lib/notifications/topics';

/**
 * Which notices reach the email (`s12`, spec 0005 AC-32). Email only: no SMS and no in site column. A row
 * with a topic has a switch; the rest are always on and shown that way, with no switch to pretend otherwise.
 */
export function NotificationTable({
  rows,
  turnedOff,
}: {
  rows: readonly NoticeRow[];
  turnedOff: readonly string[];
}) {
  const t = useTranslations('Account');
  const [off, setOff] = useState<ReadonlySet<string>>(new Set(turnedOff));
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onToggle(topic: Topic, enabled: boolean) {
    const previous = off;
    const next = new Set(off);
    if (enabled) next.delete(topic);
    else next.add(topic);
    setOff(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setNotificationPreference({ topic, enabled });
      if (!result.success) {
        setOff(previous);
        setFailed(true);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-subhead text-text-primary">{t('noticesTitle')}</h2>
        <p className="text-meta leading-loose font-normal text-text-secondary">{t('noticesIntro')}</p>
      </div>

      <div className="overflow-hidden rounded-block border-2 border-border">
        <table className="w-full text-start">
          <thead className="bg-surface-secondary">
            <tr>
              <th scope="col" className="px-5.5 py-3.25 text-start text-chip text-text-secondary">
                {t('noticeColumn')}
              </th>
              <th scope="col" className="px-5.5 py-3.25 text-center text-chip text-text-secondary">
                {t('emailColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t-2 border-border-light">
                <th
                  scope="row"
                  className="px-5.5 py-3.5 text-start text-body-s font-semibold text-text-primary"
                >
                  {t(`notices.${row.key}`)}
                </th>
                <td className="px-5.5 py-3.5 text-center">
                  {row.topic ? (
                    <Switch
                      aria-label={t(`notices.${row.key}`)}
                      checked={!off.has(row.topic)}
                      disabled={isPending}
                      onCheckedChange={(enabled) => row.topic && onToggle(row.topic, enabled)}
                    />
                  ) : (
                    <span className="inline-block rounded-full bg-surface-secondary px-3.5 py-1.75 text-chip whitespace-nowrap text-text-secondary">
                      {t('alwaysOn')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failed ? (
        <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
          {t('errors.action_failed')}
        </p>
      ) : null}
    </section>
  );
}
