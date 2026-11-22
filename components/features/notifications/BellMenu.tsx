'use client';

import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { recentNoticesAction, refreshNoticeCountAction } from '@/actions/notifications';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Link, usePathname, useRouter } from '@/lib/i18n/navigation';
import { countLabel, type NoticeView } from '@/lib/notifications/kinds';
import { useNoticePings } from '@/lib/notifications/live';

import { NoticeItem } from './NoticeItem';

/**
 * The bell (`s13`, `p15`; spec 0011-18 AC-8, AC-10, X-3). The shell reads the count on the server and passes it in;
 * layouts do not render again on client navigation, so the bell asks again when the path changes, on every ping, and
 * after an open. A ping also renders the current page again (R-10). A failed count shows no badge.
 */
export function BellMenu({ userId, initialCount }: { userId: string; initialCount: number | null }) {
  const t = useTranslations('Notices');
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(initialCount);
  const [serverCount, setServerCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NoticeView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const openRef = useRef(open);
  const firstPath = useRef(true);

  // A server render (a ping's refresh, the mark all form) passes a fresh count: take it during render.
  if (initialCount !== serverCount) {
    setServerCount(initialCount);
    setCount(initialCount);
  }

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const refreshCount = useCallback(async () => {
    const result = await refreshNoticeCountAction();
    if (result.success) setCount(result.data.count);
  }, []);

  const loadItems = useCallback(async () => {
    const result = await recentNoticesAction();
    if (result.success) {
      setItems(result.data.notices);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // The first render already has the server's count.
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    void refreshCount();
  }, [pathname, refreshCount]);

  const onPing = useCallback(() => {
    void refreshCount();
    if (openRef.current) void loadItems();
    router.refresh();
  }, [refreshCount, loadItems, router]);
  useNoticePings(userId, onPing);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadItems();
  }

  const label = count === null ? null : countLabel(count);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? t('bellUnread', { count: label }) : t('bell')}
          className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-text-primary hover:bg-accent-light"
        >
          <Bell aria-hidden className="size-5" />
          {label ? (
            <span
              aria-hidden
              data-testid="bell-count"
              className="absolute -end-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-alert px-1 text-chip text-text-inverse"
            >
              {label}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-subhead text-text-primary">{t('title')}</h2>
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-label text-link">
            {t('viewAll')}
          </Link>
        </div>
        {failed ? (
          <p role="alert" className="text-meta text-error">
            {t('loadFailed')}
          </p>
        ) : items === null ? (
          <div aria-hidden className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-card bg-surface-secondary" />
            <div className="h-16 animate-pulse rounded-card bg-surface-secondary" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-meta text-text-secondary">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((notice) => (
              <li key={notice.id}>
                <NoticeItem
                  notice={notice}
                  compact
                  onOpened={() => {
                    setOpen(false);
                    void refreshCount();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
