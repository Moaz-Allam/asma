'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { acceptDocsConsent, submitProviderFile } from '@/actions/provider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { StatusChip, type ChipTone } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { track } from '@/lib/analytics/client';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { useRouter } from '@/lib/i18n/navigation';
import type { DocumentCard } from '@/lib/provider/options';
import { acceptAttribute, type DocumentType } from '@/lib/storage/buckets';

import { useProviderUpload } from './use-provider-upload';

/**
 * Step 2 (`p3`, AC-5 to AC-9, AC-12). The consent tick comes first and the cards stay disabled until it is
 * on; Storage itself refuses a document upload without the stored consent. Each card shows its state and
 * what it accepts, and replaces in place. Send for review sits at the end, in draft and rejected only.
 */

export type CardDocument = {
  type: DocumentType;
  status: 'pending' | 'approved' | 'rejected';
  rejectionCode: string | null;
  rejectionNote: string | null;
  validUntil: string | null;
};

type CardStateName = 'none' | 'uploading' | 'pending' | 'approved' | 'rejected';

const STATE_TONE: Readonly<Record<CardStateName, ChipTone>> = {
  none: 'neutral',
  uploading: 'info',
  pending: 'waiting',
  approved: 'info',
  rejected: 'negative',
};

export function DocumentsStep({
  userId,
  cards,
  documents,
  consented,
  readOnly,
  approved,
  canSubmit,
  formatDate,
}: {
  userId: string;
  cards: readonly DocumentCard[];
  documents: Partial<Record<DocumentType, CardDocument>>;
  consented: boolean;
  /** Suspended: the cards are read only. */
  readOnly: boolean;
  /** Approved or document_expired: a replacement asks first, because the file goes back to review. */
  approved: boolean;
  /** Draft or rejected: Send for review shows. */
  canSubmit: boolean;
  /** Valid until dates, formatted on the server in the page's locale. */
  formatDate: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('ProviderDocs');
  const tErrors = useTranslations('ProviderErrors');
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const [consentError, setConsentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<{ code: string; types: string[] } | null>(null);

  function onConsent() {
    setConsentError(null);
    startTransition(async () => {
      try {
        const result = await acceptDocsConsent();
        if (!result.success) return setConsentError(result.error);
      } catch {
        return setConsentError('network');
      }
      router.refresh();
    });
  }

  function onSubmit() {
    setSubmitError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof submitProviderFile>>;
      try {
        result = await submitProviderFile();
      } catch {
        return setSubmitError({ code: 'network', types: [] });
      }
      if (!result.success) return setSubmitError({ code: result.error, types: [] });
      if (result.data.incomplete) return setSubmitError(result.data.incomplete);
      track('provider_file_submitted', {});
      router.push('/provider');
      router.refresh();
    });
  }

  const locked = !consented || readOnly;

  return (
    <div className="flex flex-col gap-5">
      {!readOnly ? (
        <div className="flex items-start gap-3 rounded-block bg-surface-secondary p-5">
          <Checkbox
            id="docs-consent"
            checked={consented}
            disabled={consented || isPending || !hydrated}
            onCheckedChange={(value) => (value === true ? onConsent() : undefined)}
            className="mt-0.5"
          />
          <label htmlFor="docs-consent" className="text-body-s text-text-primary">
            {t('consent')}
          </label>
        </div>
      ) : (
        <p className="rounded-block bg-error-light p-5 text-body-s text-text-primary">{t('readOnly')}</p>
      )}
      {consentError ? (
        <p role="alert" className="text-meta text-error">
          {tErrors.has(consentError) ? tErrors(consentError) : tErrors('action_failed')}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2.5">
        {cards.map((card) =>
          card === 'id' ? (
            <IdCard
              key={card}
              userId={userId}
              front={documents.id_front}
              back={documents.id_back}
              locked={locked}
              approved={approved}
              formatDate={formatDate}
              highlighted={
                submitError?.types.some((type) => type === 'id_front' || type === 'id_back') ?? false
              }
            />
          ) : (
            <SingleCard
              key={card}
              userId={userId}
              type={card}
              doc={documents[card]}
              locked={locked}
              approved={approved}
              formatDate={formatDate}
              highlighted={submitError?.types.includes(card) ?? false}
            />
          ),
        )}
      </ul>

      {canSubmit ? (
        <div className="flex flex-col gap-3">
          {submitError ? (
            <div role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
              <p>{tErrors.has(submitError.code) ? tErrors(submitError.code) : tErrors('action_failed')}</p>
              {submitError.types.length > 0 ? (
                <ul className="mt-1 list-inside list-disc">
                  {submitError.types.map((type) => (
                    <li key={type}>{t(`missing.${type}`)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <Button size="block" onClick={onSubmit} disabled={isPending || !hydrated || readOnly}>
            {isPending ? t('submitting') : t('submit')}
          </Button>
          <p className="text-meta text-text-secondary">{t('submitNote')}</p>
        </div>
      ) : null}
    </div>
  );
}

function stateOf(doc: CardDocument | undefined): 'none' | 'pending' | 'approved' | 'rejected' {
  return doc ? doc.status : 'none';
}

/** The card's chip; `uploading` while one of its files is on its way (AC-5). */
function CardState({ doc, uploading = false }: { doc: CardDocument | undefined; uploading?: boolean }) {
  const t = useTranslations('ProviderDocs');
  const state: CardStateName = uploading ? 'uploading' : stateOf(doc);
  return <StatusChip tone={STATE_TONE[state]} label={t(`state.${state}`)} />;
}

function Rejection({ doc }: { doc: CardDocument | undefined }) {
  const tReason = useTranslations('Rejection');
  if (!doc || doc.status !== 'rejected' || !doc.rejectionCode) return null;
  return (
    <div className="rounded-row bg-error-light px-4 py-3 text-body-s text-text-primary">
      <p className="font-bold">
        {tReason.has(doc.rejectionCode) ? tReason(doc.rejectionCode) : doc.rejectionCode}
      </p>
      {doc.rejectionNote ? <p className="whitespace-pre-line break-words">{doc.rejectionNote}</p> : null}
    </div>
  );
}

/** One file input behind a pill: keyboard reaches the pill, and the input carries the card's label. */
function Picker({
  userId,
  type,
  label,
  hasFile,
  locked,
  approved,
  capture,
  onBusy,
}: {
  userId: string;
  type: DocumentType;
  label: string;
  hasFile: boolean;
  locked: boolean;
  approved: boolean;
  capture?: boolean;
  /** Tells the card an upload is running, so its chip says so. */
  onBusy?: (busy: boolean) => void;
}) {
  const t = useTranslations('ProviderDocs');
  const tProfile = useTranslations('ProviderForm');
  const tErrors = useTranslations('ProviderErrors');
  const { upload, error, isPending } = useProviderUpload(userId, type);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);

  useEffect(() => onBusy?.(isPending), [isPending, onBusy]);

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        aria-label={label}
        accept={acceptAttribute(type)}
        // Phones open the front camera; a desktop shows a file picker (AC-5). No getUserMedia: camera=() stays.
        {...(capture ? { capture: 'user' as const } : {})}
        className="sr-only"
        tabIndex={-1}
        disabled={locked || isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          // Any file registered while approved sends the file back to review, a first one too (AC-12).
          if (approved) setPending(file);
          else upload(file);
        }}
      />
      <Button
        variant={hasFile ? 'white' : 'primary'}
        size="md"
        className="self-start"
        disabled={locked || isPending}
        onClick={() => input.current?.click()}
      >
        {isPending ? t('uploading') : hasFile ? t('replace', { what: label }) : t('upload', { what: label })}
      </Button>
      {error ? (
        <p role="alert" className="text-meta text-error">
          {tErrors.has(error) ? tErrors(error) : tErrors('action_failed')}
        </p>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={hasFile ? tProfile('confirmReplaceTitle') : tProfile('confirmAddTitle')}
        body={hasFile ? tProfile('confirmReplaceBody') : tProfile('confirmAddBody')}
        confirmLabel={hasFile ? tProfile('confirmReplace') : tProfile('confirmAdd')}
        cancelLabel={tProfile('cancel')}
        onConfirm={() => {
          if (pending) upload(pending);
          setPending(null);
        }}
      />
    </div>
  );
}

function ValidUntil({
  doc,
  formatDate,
}: {
  doc: CardDocument | undefined;
  formatDate: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('ProviderDocs');
  if (!doc?.validUntil) return null;
  return (
    <p className="text-meta text-text-secondary">
      {t('validUntil', { date: formatDate[doc.validUntil] ?? doc.validUntil })}
    </p>
  );
}

function cardFrame(highlighted: boolean, state: string): string {
  if (highlighted) return 'border-2 border-error';
  if (state === 'approved' || state === 'pending') return 'border-2 border-accent-light bg-surface-secondary';
  return 'border-2 border-border';
}

function IdCard({
  userId,
  front,
  back,
  locked,
  approved,
  formatDate,
  highlighted,
}: {
  userId: string;
  front: CardDocument | undefined;
  back: CardDocument | undefined;
  locked: boolean;
  approved: boolean;
  formatDate: Readonly<Record<string, string>>;
  highlighted: boolean;
}) {
  const t = useTranslations('ProviderDocs');
  const [busy, setBusy] = useState<Partial<Record<'id_front' | 'id_back', boolean>>>({});
  const setFrontBusy = useCallback((value: boolean) => setBusy((b) => ({ ...b, id_front: value })), []);
  const setBackBusy = useCallback((value: boolean) => setBusy((b) => ({ ...b, id_back: value })), []);
  const worst = [front, back].find((d) => d?.status === 'rejected') ?? (front && back ? front : undefined);
  return (
    <li
      className={`flex flex-col gap-3 rounded-block p-5 lg:p-6.5 ${cardFrame(highlighted, stateOf(worst))}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-subhead text-text-primary">{t('id.title')}</h2>
        <CardState doc={worst} uploading={busy.id_front === true || busy.id_back === true} />
      </div>
      <p className="text-body-s text-text-body">{t('id.note')}</p>
      <p className="text-meta text-text-secondary">{t('acceptsImage')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ['id_front', front],
            ['id_back', back],
          ] as const
        ).map(([type, doc]) => (
          <div key={type} className="flex flex-col gap-2 rounded-row bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-body-s font-bold text-text-primary">{t(`id.${type}`)}</span>
              <CardState doc={doc} uploading={busy[type] === true} />
            </div>
            <ValidUntil doc={doc} formatDate={formatDate} />
            <Rejection doc={doc} />
            <Picker
              userId={userId}
              type={type}
              label={t(`id.${type}`)}
              hasFile={doc !== undefined}
              locked={locked}
              approved={approved}
              onBusy={type === 'id_front' ? setFrontBusy : setBackBusy}
            />
          </div>
        ))}
      </div>
    </li>
  );
}

function SingleCard({
  userId,
  type,
  doc,
  locked,
  approved,
  formatDate,
  highlighted,
}: {
  userId: string;
  type: Exclude<DocumentCard, 'id'>;
  doc: CardDocument | undefined;
  locked: boolean;
  approved: boolean;
  formatDate: Readonly<Record<string, string>>;
  highlighted: boolean;
}) {
  const t = useTranslations('ProviderDocs');
  const [busy, setBusy] = useState(false);
  return (
    <li className={`flex flex-col gap-3 rounded-block p-5 lg:p-6.5 ${cardFrame(highlighted, stateOf(doc))}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-subhead text-text-primary">{t(`${type}.title`)}</h2>
        {type === 'skill_certificate' ? (
          <span className="text-meta text-text-secondary">{t('optional')}</span>
        ) : null}
        <CardState doc={doc} uploading={busy} />
      </div>
      <p className="text-body-s text-text-body">{t(`${type}.note`)}</p>
      <p className="text-meta text-text-secondary">
        {type === 'selfie' ? t('acceptsImage') : t('acceptsAny')}
      </p>
      <ValidUntil doc={doc} formatDate={formatDate} />
      <Rejection doc={doc} />
      <Picker
        userId={userId}
        type={type}
        label={t(`${type}.title`)}
        hasFile={doc !== undefined}
        locked={locked}
        approved={approved}
        capture={type === 'selfie'}
        onBusy={setBusy}
      />
    </li>
  );
}
