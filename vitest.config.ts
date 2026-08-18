import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` throws on import outside a React Server Component, so it
      // cannot load in a plain test runner. Stubbing it here does NOT weaken the
      // guarantee: the real check happens at BUILD time, where Next fails the
      // build if a Client Component imports a server-only module. Vitest is not
      // Next, so there is nothing for it to protect here.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
