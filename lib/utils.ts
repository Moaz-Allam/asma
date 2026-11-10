import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Class name merging for `components/ui`. tailwind-merge must know our scales: `text-body` is a font size
 * here, and without this it would count as a colour and silently drop `text-text-primary` beside it.
 * Keep these lists equal to `--text-*` and `--radius-*` in app/globals.css.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'display',
        'hero',
        'close',
        'quick',
        'band',
        'heading',
        'band-s',
        'price-xl',
        'price-l',
        'display-l',
        'title',
        'title-s',
        'amount',
        'amount-s',
        'section',
        'digit',
        'step',
        'tile',
        'card',
        'subhead',
        'question',
        'sample',
        'group',
        'body-l',
        'lead',
        'body',
        'answer',
        'body-s',
        'label',
        'meta',
        'chip',
        'eyebrow',
        'btn-sm',
        'btn-nav',
        'btn',
        'btn-band',
        'btn-lg',
        'nav',
        'wordmark-lg',
        'wordmark',
        'wordmark-sm',
      ],
      radius: ['panel', 'block', 'card', 'tile', 'row', 'field', 'field-sm'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
