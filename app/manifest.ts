import type { MetadataRoute } from 'next';

/** Spec 0005 AC-29. Colours are the primary 900 and white of `ui-tokens.md` §2. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aldebyani Home Care',
    short_name: 'Aldebyani',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f3a73',
    icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
  };
}
