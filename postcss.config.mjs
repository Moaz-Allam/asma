// Tailwind v4 is wired through PostCSS. There is deliberately no tailwind.config —
// v4 defines tokens with @theme in app/globals.css, and ui-tokens.md §11 forbids
// putting colours in a config file.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
