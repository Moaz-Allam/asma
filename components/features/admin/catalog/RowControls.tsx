'use client';

import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * The controls every catalog row shares (spec 0007 AC-17): up and down, an on and off switch, and edit.
 * Each control is at least 44px and named for the row, so a screen reader hears which row it moves.
 */
export function RowControls({
  name,
  active,
  first,
  last,
  busy,
  onMove,
  onToggle,
  onEdit,
  showSwitch = true,
}: {
  name: string;
  showSwitch?: boolean;
  active: boolean;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
}) {
  const t = useTranslations('AdminCatalog');
  const square =
    'inline-flex size-11 items-center justify-center rounded-full bg-surface-secondary text-text-primary disabled:opacity-40';

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        className={square}
        disabled={busy || first}
        onClick={() => onMove('up')}
        aria-label={t('moveUp', { name })}
      >
        <ChevronUp className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={square}
        disabled={busy || last}
        onClick={() => onMove('down')}
        aria-label={t('moveDown', { name })}
      >
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {showSwitch ? (
        <label className={cn('inline-flex min-h-11 items-center gap-2 px-1.5', busy && 'opacity-60')}>
          <Switch
            checked={active}
            disabled={busy}
            onCheckedChange={onToggle}
            aria-label={t(active ? 'turnOff' : 'turnOn', { name })}
          />
          <span className="text-meta text-text-secondary">{t(active ? 'on' : 'off')}</span>
        </label>
      ) : null}
      <button
        type="button"
        className={square}
        disabled={busy}
        onClick={onEdit}
        aria-label={t('edit', { name })}
      >
        <Pencil className="size-4" aria-hidden />
      </button>
    </div>
  );
}
