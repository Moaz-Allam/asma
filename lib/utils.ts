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
        'price-xl',
        'price-l',
        'display-l',
        'title',
        'section',
        'card',
        'group',
        'body-l',
        'body',
        'body-s',
        'label',
        'meta',
        'chip',
        'eyebrow',
        'btn-sm',
        'btn',
        'btn-lg',
        'nav',
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
