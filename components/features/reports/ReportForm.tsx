'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { addReportPhotoAction, openReportAction } from '@/actions/reports';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { track } from '@/lib/analytics/client';
import { Link } from '@/lib/i18n/navigation';
import {
  REPORT_REASONS,
  REPORT_TEXT_MAX,
  REPORT_TEXT_MIN,
  reportTextLength,
  type ReportReason,
} from '@/lib/reports/constants';
import { REPORT_PHOTO_MAX } from '@/lib/storage/buckets';
import { localPreview, uploadReportPhoto } from '@/lib/storage/client';

type Photo = {
  key: string;
  file: File;
  preview: string;
  state: 'waiting' | 'done' | 'failed';
  error?: string;
};

/**
 * The one report form, for the customer and the provider (ui-registry `ReportForm`, spec 0011-14 AC-1, AC-2, AC-7,
 * X-25): a reason chip, the text with its count, up to three photos. The report is created first; then each photo
 * is uploaded and registered in turn. A photo that fails shows a retry while the report is open, and the report is
 * never rolled back. Postgres decides everything again (R-1 to R-4, X-5).
 */
export function ReportForm({
  requestId,
  region,
  side,
  backHref,
  initialReason = null,
}: {
  requestId: string;
  region: string;
  side: 'customer' | 'provider';
  backHref: string;
  initialReason?: ReportReason | null;
}) {
  const t = useTranslations('Reports');
  const textId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState<ReportReason | null>(initialReason);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reportId, setReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // Each preview is a blob URL: give it back when the photo goes or the form unmounts.
  const previews = useRef<string[]>([]);
  useEffect(() => {
    const list = previews.current;
    return () => list.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const length = reportTextLength(text);
  const ready = reason !== null && length >= REPORT_TEXT_MIN && length <= REPORT_TEXT_MAX;
  const sent = reportId !== null && photos.every((photo) => photo.state === 'done');

  function pick(files: FileList | null) {
    if (!files) return;
    const room = REPORT_PHOTO_MAX - photos.length;
    const added = Array.from(files)
      .slice(0, Math.max(0, room))
      .map((file) => {
        const preview = localPreview(file);
        previews.current.push(preview);
        return { key: crypto.randomUUID(), file, preview, state: 'waiting' as const };
      });
    setPhotos((current) => [...current, ...added]);
    if (fileRef.current) fileRef.current.value = '';
  }

  function remove(key: string) {
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  }

  async function sendPhoto(id: string, photo: Photo): Promise<Photo> {
    const uploaded = await uploadReportPhoto(region, id, photo.file);
    if (!uploaded.ok) return { ...photo, state: 'failed', error: t(`errors.${uploaded.code}`) };
    let result: Awaited<ReturnType<typeof addReportPhotoAction>>;
    try {
      result = await addReportPhotoAction({ reportId: id, path: uploaded.path });
    } catch {
      result = { success: false, error: 'action_failed' };
    }
    if (!result.success) {
      return { ...photo, state: 'failed', error: t(`errors.${result.error}` as 'errors.action_failed') };
    }
    return { ...photo, state: 'done' };
  }

  async function sendPhotos(id: string, list: Photo[]) {
    const next: Photo[] = [];
    for (const photo of list) {
      next.push(photo.state === 'done' ? photo : await sendPhoto(id, photo));
    }
    setPhotos(next);
  }

  function submit() {
    if (!ready || reason === null) return;
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof openReportAction>>;
      try {
        result = await openReportAction({ requestId, reason, text });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        setError(t(`errors.${result.error}` as 'errors.action_failed'));
        return;
      }
      track('report_opened', { reason, side });
      setReportId(result.data.reportId);
      await sendPhotos(result.data.reportId, photos);
    });
  }

  function retry() {
    if (!reportId) return;
    start(async () => {
      await sendPhotos(reportId, photos);
    });
  }

  if (sent) {
    return (
      <section
        role="status"
        aria-labelledby="report-sent"
        className="flex flex-col gap-3 rounded-panel bg-success-light p-5 lg:p-7.5"
      >
        <h2 id="report-sent" className="font-display text-title-s text-text-primary">
          {t('form.sentTitle')}
        </h2>
        <p className="text-body text-text-primary">{t('form.sentBody')}</p>
        <Button asChild variant="outline" className="self-start">
          <Link href={backHref}>{t('form.done')}</Link>
        </Button>
      </section>
    );
  }

  const failed = photos.filter((photo) => photo.state === 'failed');
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (reportId) retry();
        else submit();
      }}
    >
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      {reportId !== null ? (
        <p role="status" className="rounded-block bg-success-light p-4 text-body-s text-success-foreground">
          {t('form.sentTitle')}
        </p>
      ) : null}
      <ChoiceChips
        name="report-reason"
        legend={t('form.reason')}
        options={REPORT_REASONS.map((value) => ({ value, label: t(`reasons.${value}`) }))}
        value={reason}
        onChange={setReason}
        disabled={busy || reportId !== null}
      />
      <FormField id={textId} label={t('form.text')} note={t('form.textHint', { count: length })}>
        <Textarea
          id={textId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          maxLength={REPORT_TEXT_MAX + 50}
          disabled={busy || reportId !== null}
          required
        />
      </FormField>
      <fieldset className="flex flex-col gap-3" disabled={busy}>
        <legend className="mb-1 text-body-s font-bold text-text-primary">{t('form.photos')}</legend>
        <p className="text-meta text-text-secondary">{t('form.photosHint')}</p>
        {photos.length > 0 ? (
          <ul className="flex flex-wrap gap-3">
            {photos.map((photo, index) => (
              <li key={photo.key} className="flex flex-col items-start gap-2">
                {/* A local preview of the photo just picked: a blob URL never leaves the browser. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.preview}
                  alt={t('form.photoAlt', { number: index + 1 })}
                  className="size-24 rounded-block object-cover"
                />
                {photo.state === 'failed' ? (
                  <p className="max-w-24 text-meta text-error">
                    {t('form.photoFailed', { number: index + 1 })} {photo.error}
                  </p>
                ) : null}
                {reportId === null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => remove(photo.key)}
                  >
                    {t('form.removePhoto', { number: index + 1 })}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {reportId === null && photos.length < REPORT_PHOTO_MAX ? (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              multiple
              className="sr-only"
              id={`${textId}-photos`}
              aria-label={t('form.addPhoto')}
              tabIndex={-1}
              onChange={(event) => pick(event.target.files)}
            />
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
              {t('form.addPhoto')}
            </Button>
          </div>
        ) : null}
      </fieldset>
      <p className="text-body-s text-text-secondary">{t('form.cash')}</p>
      <div className="flex flex-wrap gap-3">
        {reportId === null ? (
          <Button type="submit" disabled={!ready || busy}>
            {busy ? t('form.sending') : t('form.submit')}
          </Button>
        ) : failed.length > 0 ? (
          <Button type="submit" disabled={busy}>
            {busy ? t('form.sending') : t('form.retry')}
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={backHref}>{t('form.back')}</Link>
        </Button>
      </div>
    </form>
  );
}
