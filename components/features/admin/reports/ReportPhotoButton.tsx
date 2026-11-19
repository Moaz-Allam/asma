'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { reportPhotoLinkAction } from '@/actions/admin-reports';
import { Button } from '@/components/ui/button';

/**
 * One report photo behind Show (ui-registry `ReportPhotoButton`, spec 0011-14 AC-4, X-3): the press records the
 * view, then the server signs a 60 second link, drawn as a plain image. Nothing is fetched before the press.
 */
export function ReportPhotoButton({ photoId, number }: { photoId: string; number: number }) {
  const t = useTranslations('AdminReports');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function show() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof reportPhotoLinkAction>>;
      try {
        result = await reportPhotoLinkAction({ photoId });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        setError(t(`errors.${result.error}` as 'errors.action_failed'));
        return;
      }
      if (!result.data.url) setError(t('photoGone'));
      setUrl(result.data.url);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {url ? (
        // A plain <img>, never next/image: its optimizer would fetch and cache a signed link on our server.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={t('show', { number })}
          className="max-h-96 w-full max-w-md rounded-block object-contain"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Button type="button" variant="secondary" disabled={busy} onClick={show}>
          {t('show', { number })}
        </Button>
      )}
      {error ? <p className="text-meta text-error">{error}</p> : null}
    </div>
  );
}
