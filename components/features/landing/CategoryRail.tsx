'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

const ARROW = 'hidden size-11 p-0 text-text-primary lg:inline-flex';

/**
 * The row of categories with its two arrows (`s1`). The row scrolls by finger on a phone. On a wide screen
 * the launch categories all fit, so the arrows only move it once the catalog grows past five.
 */
export function CategoryRail({
  previous,
  next,
  children,
}: {
  previous: string;
  next: string;
  children: ReactNode;
}) {
  const rail = useRef<HTMLUListElement>(null);

  function move(step: 1 | -1) {
    const list = rail.current;
    if (!list) return;
    const direction = getComputedStyle(list).direction === 'rtl' ? -1 : 1;
    list.scrollBy({ left: direction * step * (list.clientWidth / 2), behavior: 'smooth' });
  }

  return (
    <div className="flex items-center gap-3.5">
      <Button
        variant="secondary"
        size="text"
        aria-label={previous}
        onClick={() => move(-1)}
        className={ARROW}
      >
        <ArrowLeft aria-hidden className="rtl:rotate-180" />
      </Button>
      <ul
        ref={rail}
        className="flex min-w-0 flex-1 snap-x gap-3 overflow-x-auto [scrollbar-width:none] lg:grid lg:grid-cols-5"
      >
        {children}
      </ul>
      <Button variant="secondary" size="text" aria-label={next} onClick={() => move(1)} className={ARROW}>
        <ArrowRight aria-hidden className="rtl:rotate-180" />
      </Button>
    </div>
  );
}
