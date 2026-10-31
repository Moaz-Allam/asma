import { Alexandria, Archivo_Black, Cairo } from 'next/font/google';

/**
 * The three families (D43, D48, ui-tokens.md §5), self hosted by next/font, so no third party request at
 * runtime and `font-src 'self'` holds. Set once, on <html> in the root layout.
 *
 * Cairo has no `₺` glyph, so every amount is set in `font-display`.
 */

const cairo = Cairo({
  subsets: ['arabic', 'latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-cairo',
  display: 'swap',
});

const alexandria = Alexandria({
  subsets: ['arabic', 'latin', 'latin-ext'],
  weight: ['700', '800', '900'],
  variable: '--font-alexandria',
  display: 'swap',
});

const archivoBlack = Archivo_Black({
  subsets: ['latin', 'latin-ext'],
  weight: '400',
  variable: '--font-archivo-black',
  display: 'swap',
});

export const fontVariables = `${cairo.variable} ${alexandria.variable} ${archivoBlack.variable}`;
