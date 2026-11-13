'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import {
  decideProvider,
  reinstateProvider,
  reviewDocuments,
  showDocument,
  suspendProvider,
} from '@/actions/admin-providers';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { StatusChip, type ChipTone } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { track } from '@/lib/analytics/client';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { useRouter } from '@/lib/i18n/navigation';
import {
  LIMITS,
  REJECT_CHIPS,
  REJECTION_CODES,
  VALID_UNTIL_TYPES,
  type RejectionCode,
} from '@/lib/provider/options';
import { SIGNED_LINK_SECONDS, type DocumentType } from '@/lib/storage/buckets';
import { cn } from '@/lib/utils';

/**
 * Admin's side of a file (`app-03`, `a1`, `a2`, AC-16 to AC-19). No file loads with the page: Show writes
 * the view row and only then gets a 60 second link. Match opens after Show (the database also refuses it,
 * `view_required`). Each verdict names the object it saw, so a replaced file is `stale_document`. Approve
 * sends back the profile version the page rendered (`stale_profile`).
 */

export type ReviewDocument = {
  id: string;
  type: DocumentType;
  objectId: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionCode: string | null;
  rejectionNote: string | null;
  validUntil: string | null;
  /** validUntil formatted on the server, in the page's locale. */
  validUntilLabel: string | null;
};

/** A shown file. A PDF link dies with its signed URL, so `expired` brings Show back. */
type Shown = { url: string; kind: 'image' | 'pdf'; expired?: boolean };

const DOC_TONE: Readonly<Record<ReviewDocument['status'], ChipTone>> = {
  pending: 'waiting',
  approved: 'info',
  rejected: 'negative',
};

export function ProviderFileReview({
  providerId,
  status,
  seenUpdatedAt,
  documents,
  requiredTypes,
  canApprove,
  hasRejectedRequired,
  reviewed,
  total,
}: {
  providerId: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  seenUpdatedAt: string;
  documents: ReviewDocument[];
  requiredTypes: DocumentType[];
  canApprove: boolean;
  hasRejectedRequired: boolean;
  reviewed: number;
  total: number;
}) {
  const t = useTranslations('AdminReview');
  const tErrors = useTranslations('AdminReview.errors');
  const router = useRouter();
  const hydrated = useHydrated();
  const [isPending, startTransition] = useTransition();
  const [shown, setShown] = useState<Record<string, Shown>>({});
  const [error, setError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState('');
  const [fileCode, setFileCode] = useState<RejectionCode | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [liftOpen, setLiftOpen] = useState(false);
  const [reason, setReason] = useState('');

  const byType = new Map(documents.map((d) => [d.type, d]));
  const underReview = status === 'pending';

  function fail(code: string) {
    setError(code);
    if (code === 'stale_document' || code === 'stale_profile' || code === 'not_under_review')
      router.refresh();
  }

  function show(doc: ReviewDocument) {
    setError(null);
    startTransition(async () => {
      const result = await showDocument({ documentId: doc.id, objectId: doc.objectId });
      if (!result.success) return fail(result.error);
      const view = result.data;
      setShown((current) => ({ ...current, [doc.objectId]: view }));
      if (view.kind === 'pdf') {
        // A few seconds before Storage refuses the link, swap it back for Show (one more view row).
        setTimeout(
          () =>
            setShown((current) =>
              current[doc.objectId]?.url === view.url
                ? { ...current, [doc.objectId]: { ...view, expired: true } }
                : current,
            ),
          (SIGNED_LINK_SECONDS - 5) * 1000,
        );
      }
    });
  }

  function verdict(
    docs: ReviewDocument[],
    input: {
      verdict: 'approved' | 'rejected';
      code: RejectionCode | null;
      note: string | null;
      validUntil: string | null;
    },
  ) {
    setError(null);
    startTransition(async () => {
      const result = await reviewDocuments({
        providerId,
        ids: docs.map((d) => d.id),
        objectIds: docs.map((d) => d.objectId),
        ...input,
      });
      if (!result.success) return fail(result.error);
      router.refresh();
    });
  }

  function decide(decision: 'approved' | 'rejected') {
    setError(null);
    startTransition(async () => {
      const result = await decideProvider({
        providerId,
        decision,
        seenUpdatedAt,
        code: decision === 'rejected' ? fileCode : null,
        note: decision === 'rejected' && fileNote.trim() !== '' ? fileNote : null,
      });
      if (!result.success) return fail(result.error);
      // A second click or a second admin replays the decision: the event fires once.
      if (result.data.status === decision && !result.data.replayed) track('provider_decided', { decision });
      router.refresh();
    });
  }

  function suspend() {
    setError(null);
    startTransition(async () => {
      const result = await suspendProvider({ providerId, reason });
      setSuspendOpen(false);
      if (!result.success) return fail(result.error);
      setReason('');
      router.refresh();
    });
  }

  function lift() {
    setError(null);
    startTransition(async () => {
      const result = await reinstateProvider({ providerId });
      setLiftOpen(false);
      if (!result.success) return fail(result.error);
      router.refresh();
    });
  }

  const groups: Array<{ key: string; docs: ReviewDocument[]; type: DocumentType }> = [];
  const front = byType.get('id_front');
  const back = byType.get('id_back');
  if (front || back)
    groups.push({
      key: 'id',
      type: 'id_front',
      docs: [front, back].filter((d): d is ReviewDocument => d !== undefined),
    });
  for (const type of ['profile_photo', 'selfie', 'criminal_record', 'skill_certificate'] as const) {
    const doc = byType.get(type);
    if (doc) groups.push({ key: type, type, docs: [doc] });
  }

  const reasonLength = [...reason.trim()].length;

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
          {tErrors.has(error) ? tErrors(error) : tErrors('action_failed')}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-subhead text-text-primary">{t('documents')}</h2>
        {groups.length === 0 ? <p className="text-body-s text-text-secondary">{t('noDocuments')}</p> : null}
        <ul className="grid gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <DocumentCard
              key={group.key}
              group={group}
              shown={shown}
              required={group.docs.some((d) => requiredTypes.includes(d.type))}
              underReview={underReview}
              busy={isPending || !hydrated}
              onShow={show}
              onVerdict={verdict}
            />
          ))}
        </ul>
      </section>

      {underReview ? (
        <section className="flex flex-col gap-4 rounded-panel border-2 border-border p-5.5">
          <p className="text-meta text-text-secondary">{t('reviewed', { done: reviewed, total })}</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="file-note">{t('fileNote')}</Label>
            <Textarea
              id="file-note"
              value={fileNote}
              onChange={(e) => setFileNote(e.target.value)}
              maxLength={LIMITS.noteMax}
              rows={3}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body-s font-bold text-text-primary">{t('fileChip')}</legend>
            <div className="flex flex-wrap gap-2">
              {REJECTION_CODES.map((code) => (
                <ChipButton
                  key={code}
                  code={code}
                  selected={fileCode === code}
                  onClick={() => setFileCode(fileCode === code ? null : code)}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2.5">
            <Button
              size="lg"
              onClick={() => decide('approved')}
              disabled={!canApprove || isPending || !hydrated}
            >
              {t('approve')}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => decide('rejected')}
              disabled={(!hasRejectedRequired && fileNote.trim() === '') || isPending || !hydrated}
            >
              {t('rejectFile')}
            </Button>
          </div>
          {!canApprove ? <p className="text-meta text-text-secondary">{t('approveHint')}</p> : null}
        </section>
      ) : null}

      {status === 'approved' ? (
        <section className="flex flex-col items-start gap-3 rounded-panel bg-surface-secondary p-5.5">
          <h2 className="text-eyebrow text-text-secondary">{t('actions')}</h2>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => setSuspendOpen(true)}
            disabled={isPending || !hydrated}
          >
            {t('suspend')}
          </Button>
        </section>
      ) : null}
      {status === 'suspended' ? (
        <section className="flex flex-col items-start gap-3 rounded-panel bg-surface-secondary p-5.5">
          <h2 className="text-eyebrow text-text-secondary">{t('actions')}</h2>
          <Button size="lg" onClick={() => setLiftOpen(true)} disabled={isPending || !hydrated}>
            {t('lift')}
          </Button>
        </section>
      ) : null}

      <ConfirmDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={t('suspendTitle')}
        body={t('suspendBody')}
        confirmLabel={t('suspendConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={() =>
          reasonLength >= LIMITS.suspensionMin && reasonLength <= LIMITS.suspensionMax
            ? suspend()
            : setError('reason_short')
        }
        busy={isPending}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="suspend-reason">{t('suspendReason')}</Label>
          <Textarea
            id="suspend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={LIMITS.suspensionMax}
            rows={4}
          />
          {error === 'reason_short' ? (
            <p className="text-meta text-error">{tErrors('reason_short')}</p>
          ) : null}
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={liftOpen}
        onOpenChange={setLiftOpen}
        title={t('liftTitle')}
        body={t('liftBody')}
        confirmLabel={t('liftConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={lift}
        busy={isPending}
      />
    </div>
  );
}

function ChipButton({
  code,
  selected,
  onClick,
}: {
  code: RejectionCode;
  selected: boolean;
  onClick: () => void;
}) {
  const tReason = useTranslations('Rejection');
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full px-4.5 py-2.5 text-btn-sm',
        selected ? 'bg-accent text-accent-foreground' : 'bg-surface-secondary text-text-primary',
      )}
    >
      {tReason(code)}
    </button>
  );
}

function DocumentCard({
  group,
  shown,
  required,
  underReview,
  busy,
  onShow,
  onVerdict,
}: {
  group: { key: string; docs: ReviewDocument[]; type: DocumentType };
  shown: Record<string, Shown>;
  required: boolean;
  underReview: boolean;
  busy: boolean;
  onShow: (doc: ReviewDocument) => void;
  onVerdict: (
    docs: ReviewDocument[],
    input: {
      verdict: 'approved' | 'rejected';
      code: RejectionCode | null;
      note: string | null;
      validUntil: string | null;
    },
  ) => void;
}) {
  const t = useTranslations('AdminReview');
  const tType = useTranslations('ProviderDocs.missing');
  const tStatus = useTranslations('AdminReview.docStatus');
  const tReason = useTranslations('Rejection');
  const [validUntil, setValidUntil] = useState('');
  const [code, setCode] = useState<RejectionCode | null>(null);
  const [note, setNote] = useState('');

  const isId = group.key === 'id';
  const dated = VALID_UNTIL_TYPES.includes(group.type);
  const allShown = group.docs.every((d) => shown[d.objectId] !== undefined);
  const complete = !isId || group.docs.length === 2;
  const status =
    group.docs.find((d) => d.status === 'rejected')?.status ?? group.docs[0]?.status ?? 'pending';
  const first = group.docs[0];
  const chips = REJECT_CHIPS[group.type];
  const title = isId ? t('idTitle') : tType(group.type);

  return (
    <li className="flex flex-col gap-3 rounded-block border-2 border-border p-4.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-body-s font-bold text-text-primary">{title}</h3>
        {!required ? <span className="text-meta text-text-secondary">{t('optional')}</span> : null}
        <StatusChip tone={DOC_TONE[status]} label={tStatus(status)} />
      </div>
      {first?.validUntil ? (
        <p className="text-meta text-text-secondary">
          {t('validUntilShown', { date: first.validUntilLabel ?? first.validUntil })}
        </p>
      ) : null}
      {first?.rejectionCode ? (
        <p className="text-meta break-words text-text-primary">
          {tReason.has(first.rejectionCode) ? tReason(first.rejectionCode) : first.rejectionCode}
          {first.rejectionNote ? ` · ${first.rejectionNote}` : ''}
        </p>
      ) : null}

      {group.docs.map((doc) => {
        const view = shown[doc.objectId];
        return (
          <div key={doc.id} className="flex flex-col gap-2">
            {isId ? <span className="text-meta text-text-secondary">{tType(doc.type)}</span> : null}
            {view?.kind === 'image' ? (
              // A plain <img>, never next/image: its optimizer would fetch and cache a signed link on our server.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={view.url}
                alt={t('imageAlt', { what: tType(doc.type) })}
                className="max-h-80 w-full rounded-row bg-surface-secondary object-contain"
              />
            ) : null}
            {view?.kind === 'pdf' && !view.expired ? (
              // Drawn after the action returns: Safari blocks window.open after an await.
              <a href={view.url} target="_blank" rel="noreferrer" className="text-btn-sm text-link underline">
                {t('openPdf')}
              </a>
            ) : null}
            {!view || view.expired ? (
              <Button
                variant="secondary"
                size="md"
                className="self-start"
                onClick={() => onShow(doc)}
                disabled={busy}
              >
                {t('show', { what: tType(doc.type) })}
              </Button>
            ) : null}
          </div>
        );
      })}

      {underReview && complete ? (
        <div className="flex flex-col gap-3 border-t-2 border-border-light pt-3">
          {dated ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`valid-${group.key}`}>{t('validUntil')}</Label>
              <Input
                id={`valid-${group.key}`}
                type="date"
                dir="ltr"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="text-start"
              />
            </div>
          ) : null}
          <Button
            size="md"
            className="self-start"
            disabled={busy || !allShown}
            onClick={() =>
              onVerdict(group.docs, {
                verdict: 'approved',
                code: null,
                note: null,
                validUntil: dated ? validUntil || null : null,
              })
            }
          >
            {t('match')}
          </Button>
          {!allShown ? <p className="text-meta text-text-secondary">{t('matchHint')}</p> : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-meta font-bold text-text-primary">{t('rejectReason')}</legend>
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <ChipButton
                  key={c}
                  code={c}
                  selected={code === c}
                  onClick={() => setCode(code === c ? null : c)}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`note-${group.key}`}>{t('note')}</Label>
            <Textarea
              id={`note-${group.key}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={LIMITS.noteMax}
              rows={2}
            />
          </div>
          <Button
            size="md"
            variant="outline"
            className="self-start"
            disabled={busy || code === null}
            onClick={() =>
              onVerdict(group.docs, {
                verdict: 'rejected',
                code,
                note: note.trim() === '' ? null : note,
                validUntil: null,
              })
            }
          >
            {t('reject')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
