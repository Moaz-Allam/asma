import { Check, Circle, X } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import type { ProviderFile } from '@/lib/provider/queries';
import type { DocumentType } from '@/lib/storage/buckets';
import { cn } from '@/lib/utils';

/**
 * How far the file is (`p2` side panel, AC-1). Rows: phone (always done), profile (the profile row and the
 * photo), ID (both sides), selfie, and the criminal record when the region requires it. A row is done when
 * its rows exist and none is rejected. Percent is floor(done / total * 100).
 */
type Row = {
  key: 'phone' | 'profile' | 'id' | 'selfie' | 'criminal_record';
  state: 'done' | 'missing' | 'rejected';
};

export function progressRows(file: ProviderFile): Row[] {
  const state = (types: DocumentType[], extra = true): Row['state'] => {
    const docs = types.map((type) => file.documents[type]);
    if (docs.some((doc) => doc?.status === 'rejected')) return 'rejected';
    return extra && docs.every((doc) => doc !== undefined) ? 'done' : 'missing';
  };
  const rows: Row[] = [
    { key: 'phone', state: 'done' },
    { key: 'profile', state: state(['profile_photo'], file.profile !== null && file.entityType !== null) },
    { key: 'id', state: state(['id_front', 'id_back']) },
    { key: 'selfie', state: state(['selfie']) },
  ];
  if (file.requiredTypes.includes('criminal_record'))
    rows.push({ key: 'criminal_record', state: state(['criminal_record']) });
  return rows;
}

export function progressPercent(rows: Row[]): number {
  return Math.floor((rows.filter((row) => row.state === 'done').length / rows.length) * 100);
}

export async function FileProgress({ file }: { file: ProviderFile }) {
  const t = await getTranslations('Provider.progress');
  const rows = progressRows(file);
  const percent = progressPercent(rows);

  return (
    <section
      aria-labelledby="file-progress"
      className="flex flex-col gap-4 rounded-panel bg-surface-secondary p-6.5"
    >
      <div className="flex items-baseline gap-2.5">
        <h2 id="file-progress" className="flex-1 text-eyebrow text-text-secondary">
          {t('title')}
        </h2>
        <span className="font-display text-amount-s text-text-primary">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-labelledby="file-progress"
        className="h-3 overflow-hidden rounded-full bg-track"
      >
        <div className="h-3 rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3">
            {row.state === 'done' ? (
              <Check aria-hidden className="size-4 text-text-primary" />
            ) : row.state === 'rejected' ? (
              <X aria-hidden className="size-4 text-error" />
            ) : (
              <Circle aria-hidden className="size-4 text-text-secondary" />
            )}
            <span
              className={cn(
                'flex-1 text-body-s font-semibold',
                row.state === 'done' ? 'text-text-primary' : 'text-text-secondary',
              )}
            >
              {t(row.key)}
            </span>
            <span className="text-meta text-text-secondary">{t(row.state)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
