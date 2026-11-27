'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Link } from '@/lib/i18n/navigation';
import { PUBLIC_ANCHORS } from '@/lib/navigation/menus';

/** The menu of the public pages, on every width as `s1` draws it. It drops from the top and stacks anchors, both calls to action and the language (AC-27). */
export function PublicMenu() {
  const t = useTranslations('Nav');
  const tLanding = useTranslations('Landing');
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t('openMenu')}
          className="flex size-11 shrink-0 flex-col items-center justify-center gap-1.25 rounded-full transition-colors hover:bg-surface-secondary"
        >
          <span className="h-0.75 w-6.5 rounded-xs bg-accent" />
          <span className="h-0.75 w-6.5 rounded-xs bg-accent" />
        </button>
      </SheetTrigger>
      <SheetContent side="top" closeLabel={t('closeMenu')} className="gap-0">
        <div className="mx-auto w-full max-w-7xl">
          <SheetHeader className="lg:px-8.5">
            <SheetTitle>{t('main')}</SheetTitle>
          </SheetHeader>
          <nav aria-label={t('main')} className="flex flex-col px-5 lg:px-8.5">
            {PUBLIC_ANCHORS.map(({ key, hash }) => (
              <Link
                key={key}
                href={{ pathname: '/', hash }}
                onClick={close}
                className="border-t-2 border-border-light py-4 text-nav hover:text-link"
              >
                {t(key)}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col gap-3 border-t-2 border-border-light p-5 lg:px-8.5">
            <Button asChild size="band">
              <Link
                href={{ pathname: '/login', query: { mode: 'code', next: '/requests/new' } }}
                onClick={close}
              >
                {tLanding('cta')}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="band">
              <Link href={{ pathname: '/login', query: { mode: 'code', as: 'provider' } }} onClick={close}>
                {tLanding('ctaProvider')}
              </Link>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
