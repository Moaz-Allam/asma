'use client';

import { useTranslations } from 'next-intl';
import { useState, type MouseEvent } from 'react';

import { openNoticeAction } from '@/actions/notifications';
import { Link, useRouter } from '@/lib/i18n/navigation';
import type { NoticeView } from '@/lib/notifications/kinds';
import { cn } from '@/lib/utils';

/**
 * One notice (`s13`, `p15`; spec 0011-18 AC-6, AC-7, AC-9). A link to the page it is about, its href computed on the
 * server. With script, opening marks it read first and follows the link the database returns; without script the link
 * still opens the page. Unread is never colour alone: the dot, a bold title and the word "Unread" for screen readers.
 */
export function NoticeItem({
  notice,
  compact = false,
  onOpened,
}: {
  notice: NoticeView;
  compact?: boolean;
  onOpened?: () => void;
}) {
  const t = useTranslations('Notices');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await openNoticeAction({ id: notice.id });
    onOpened?.();
    router.push(result.success ? result.data.href : notice.href);
    setBusy(false);
  }

  return (
    <Link
      href={notice.href}
      onClick={onClick}
      aria-busy={busy || undefined}
      className={cn(
        'flex items-start gap-3 rounded-card border-2 text-start transition-colors hover:border-accent',
        compact ? 'px-4 py-3' : 'px-5.5 py-4.5',
        notice.unread ? 'border-accent-light bg-surface-secondary' : 'border-border bg-surface',
      )}
    >
      <span
        aria-hidden
        className={cn('mt-2 size-2.5 shrink-0 rounded-full', notice.unread ? 'bg-alert' : 'bg-border')}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn('text-body text-text-primary', notice.unread ? 'font-extrabold' : 'font-semibold')}
        >
          {notice.unread ? <span className="sr-only">{`${t('unread')}: `}</span> : null}
          {notice.title}
        </span>
        <span className="text-meta text-text-secondary">{notice.line}</span>
      </span>
      <span className="shrink-0 text-chip text-text-muted">{notice.ago}</span>
    </Link>
  );
}
