import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import type { Standing } from '@/lib/provider/options';
import type { ProviderFile } from '@/lib/provider/queries';
import type { DocumentType } from '@/lib/storage/buckets';

/**
 * What a provider sees on `/provider` for pending, rejected, suspended and document_expired (`p5`, `p14`,
 * AC-10). Reason codes map to catalogue keys; admin's own words (a note, a suspension reason) show escaped,
 * as written. The blurred requests, the while you wait panel and the SMS promise are left out on purpose.
 */
export async function AccountStateBanner({
  standing,
  file,
}: {
  standing: Exclude<Standing, 'draft' | 'approved'>;
  file: ProviderFile;
}) {
  const t = await getTranslations('Provider.home');
  const tReason = await getTranslations('Rejection');
  const tType = await getTranslations('ProviderDocs.missing');

  const docs = Object.values(file.documents);
  const rejected = docs.filter((d) => d.status === 'rejected');
  const expired = docs.filter(
    (d) => d.validUntil !== null && d.validUntil < new Date().toISOString().slice(0, 10),
  );
  const reason = (code: string | null) => (code && tReason.has(code) ? tReason(code) : null);

  const items: Array<{ type: DocumentType; reason: string | null; note: string | null }> =
    standing === 'document_expired'
      ? expired.map((d) => ({ type: d.type, reason: tReason('document_expired'), note: null }))
      : rejected.map((d) => ({ type: d.type, reason: reason(d.rejectionCode), note: d.rejectionNote }));

  const pendingRows = docs.filter((d) => d.status !== 'rejected');

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
      <div className="flex min-w-0 flex-col gap-3.5">
        <section className="flex flex-col gap-3 rounded-panel bg-accent-light p-6.5 lg:p-9">
          <h2 className="font-display text-title text-text-primary">{t(`${standing}.title`)}</h2>
          <p className="max-w-52ch text-body text-text-primary">{t(`${standing}.body`)}</p>
        </section>

        {standing === 'pending' ? (
          <ul className="flex flex-col gap-2.5">
            {pendingRows.map((d) => (
              <li
                key={d.type}
                className="flex items-center gap-3.5 rounded-row bg-surface-secondary px-5.5 py-4.5"
              >
                <span className="flex-1 text-body-s font-semibold text-text-primary">{tType(d.type)}</span>
                <span className="text-meta text-text-secondary">{t(`docState.${d.status}`)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {standing === 'suspended' && file.suspensionReason ? (
          <section className="flex flex-col gap-2 rounded-block border-2 border-border p-5.5">
            <h3 className="text-meta font-bold text-text-secondary">{t('suspended.reasonLabel')}</h3>
            <p className="text-body font-bold break-words whitespace-pre-line text-text-primary">
              {file.suspensionReason}
            </p>
          </section>
        ) : null}

        {standing === 'rejected' && (file.rejectionCode || file.rejectionNote) ? (
          <section className="flex flex-col gap-2 rounded-block border-2 border-border p-5.5">
            <h3 className="text-meta font-bold text-text-secondary">{t('rejected.fileNoteLabel')}</h3>
            {reason(file.rejectionCode) ? (
              <p className="text-body font-bold text-text-primary">{reason(file.rejectionCode)}</p>
            ) : null}
            {file.rejectionNote ? (
              <p className="text-body break-words whitespace-pre-line text-text-primary">
                {file.rejectionNote}
              </p>
            ) : null}
          </section>
        ) : null}

        {items.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li key={item.type} className="flex flex-col gap-1 rounded-row bg-error-light px-5.5 py-4">
                <span className="text-body-s font-bold text-text-primary">{tType(item.type)}</span>
                {item.reason ? <span className="text-body-s text-text-primary">{item.reason}</span> : null}
                {item.note ? (
                  <span className="text-body-s break-words whitespace-pre-line text-text-primary">
                    {item.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <aside className="flex flex-col gap-3.5 rounded-panel bg-surface-secondary p-6.5">
        <h3 className="text-eyebrow text-text-secondary">{t('nextTitle')}</h3>
        <p className="text-body-s text-text-primary">{t(`${standing}.next`)}</p>
        {standing !== 'suspended' && (standing !== 'pending' || items.length > 0) ? (
          <Button asChild size="block">
            <Link href="/provider/profile/documents">{t('toDocuments')}</Link>
          </Button>
        ) : null}
      </aside>
    </div>
  );
}
