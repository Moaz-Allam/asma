import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Proof that every single door rule in eslint.config.mjs fires where it must and stays quiet inside
 * its door (context/architecture.md §42). A lint rule nobody has seen fire is a sentence, not a guard.
 *
 * ESLint runs in one plain Node child process for all cases: loaded through Vitest's module runner,
 * eslint-config-next takes about 30 seconds to start; natively it takes about 1.5.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const LINT_ALL = `
import { ESLint } from 'eslint';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const eslint = new ESLint({ cwd: process.cwd() });
const out = [];
for (const { code, file } of JSON.parse(input)) {
  const [result] = await eslint.lintText(code, { filePath: file });
  out.push((result?.messages ?? []).map((m) => m.ruleId ?? 'fatal: ' + m.message));
}
process.stdout.write(JSON.stringify(out));
`;

const CASES: Array<{ name: string; file: string; code: string; rule: string; fires: boolean }> = [
  {
    name: 'a page creating its own Supabase client',
    file: 'app/[locale]/page.tsx',
    code: "import { createClient } from '@supabase/supabase-js';\nexport const c = createClient;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'lib/db is the Supabase door',
    file: 'lib/db/client.ts',
    code: "import { createBrowserClient } from '@supabase/ssr';\nexport const c = createBrowserClient;\n",
    rule: 'no-restricted-imports',
    fires: false,
  },
  {
    name: 'a Server Action importing the PSP adapter',
    file: 'app/[locale]/requests/actions.ts',
    code: "import { getPaymentProvider } from '@/lib/psp';\nexport const p = getPaymentProvider;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'the outbox relay may call the PSP adapter',
    file: 'lib/psp/relay/run.ts',
    code: "import { getPaymentProvider } from '@/lib/psp';\nexport const p = getPaymentProvider;\n",
    rule: 'no-restricted-imports',
    fires: false,
  },
  {
    name: 'the PSP SDK outside lib/psp',
    file: 'lib/requests/service.ts',
    code: "import iyzipay from 'iyzipay';\nexport const i = iyzipay;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'the PSP SDK inside lib/psp',
    file: 'lib/psp/iyzico/client.ts',
    code: "import iyzipay from 'iyzipay';\nexport const i = iyzipay;\n",
    rule: 'no-restricted-imports',
    fires: false,
  },
  {
    name: 'a component reaching for the service role client',
    file: 'components/features/Thing.tsx',
    code: "import { createSupabaseAdmin } from '@/lib/db/admin';\nexport const a = createSupabaseAdmin;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'a webhook route may use the service role client',
    file: 'app/api/webhooks/psp/route.ts',
    code: "import { createSupabaseAdmin } from '@/lib/db/admin';\nexport const a = createSupabaseAdmin;\n",
    rule: 'no-restricted-imports',
    fires: false,
  },
  {
    name: 'a relative climb instead of the @/ alias',
    file: 'lib/a/b/c.ts',
    code: "import { x } from '../../y';\nexport const v = x;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'the service role key read outside its door (identifier)',
    file: 'lib/requests/keys.ts',
    code: 'export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n',
    rule: 'no-restricted-syntax',
    fires: true,
  },
  {
    name: 'lib/db/admin.ts is the service role door',
    file: 'lib/db/admin.ts',
    code: 'declare const env: Record<string, string>;\nexport const k = env.SUPABASE_SERVICE_ROLE_KEY;\n',
    rule: 'no-restricted-syntax',
    fires: false,
  },
  {
    name: 'a PSP secret read through a string literal',
    file: 'lib/requests/keys2.ts',
    code: "export const k = process.env['IYZICO_SECRET_KEY'];\n",
    rule: 'no-restricted-syntax',
    fires: true,
  },
  {
    name: 'a PSP secret named in template text',
    file: 'lib/requests/keys3.ts',
    code: 'export const k = `IYZICO_API_KEY`;\n',
    rule: 'no-restricted-syntax',
    fires: true,
  },
  {
    name: 'lib/psp may read its own credentials',
    file: 'lib/psp/iyzico/config.ts',
    code: 'export const k = process.env.IYZICO_API_KEY;\n',
    rule: 'no-restricted-syntax',
    fires: false,
  },
  {
    name: 'tests may build fake environments',
    file: 'tests/env-fixture.test.ts',
    code: 'export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n',
    rule: 'no-restricted-syntax',
    fires: false,
  },
  // ── Sentry door (spec 0004 AC-8) ──
  {
    name: 'a component importing the Sentry SDK',
    file: 'components/features/Thing.tsx',
    code: "import * as Sentry from '@sentry/nextjs';\nexport const s = Sentry;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'a page importing another Sentry package',
    file: 'app/[locale]/page.tsx',
    code: "import { init } from '@sentry/browser';\nexport const i = init;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'lib/observability is the Sentry door',
    file: 'lib/observability/client.ts',
    code: "import { init } from '@sentry/nextjs';\nexport const i = init;\n",
    rule: 'no-restricted-imports',
    fires: false,
  },
  {
    name: 'next.config.ts may import the build wrapper',
    file: 'next.config.ts',
    code: "import { withSentryConfig } from '@sentry/nextjs/config';\nexport const w = withSentryConfig;\n",
    rule: 'no-restricted-imports',
    fires: false,
  },
  {
    name: 'next.config.ts may not import the SDK itself',
    file: 'next.config.ts',
    code: "import { init } from '@sentry/nextjs';\nexport const i = init;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'next.config.ts may take nothing but withSentryConfig from the build entry',
    file: 'next.config.ts',
    code: "import * as config from '@sentry/nextjs/config';\nexport const c = config;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'the DSN read outside its door',
    file: 'proxy.ts',
    code: 'export const d = process.env.NEXT_PUBLIC_SENTRY_DSN;\n',
    rule: 'no-restricted-syntax',
    fires: true,
  },
  {
    name: 'the Sentry door reads the DSN',
    file: 'lib/observability/client.ts',
    code: 'export const d = process.env.NEXT_PUBLIC_SENTRY_DSN;\n',
    rule: 'no-restricted-syntax',
    fires: false,
  },
  {
    name: 'lib/env.ts reads the DSN for everyone else',
    file: 'lib/env.ts',
    code: 'declare const env: Record<string, string>;\nexport const d = env.NEXT_PUBLIC_SENTRY_DSN;\n',
    rule: 'no-restricted-syntax',
    fires: false,
  },
  {
    name: 'the auth token stays out of the Sentry door',
    file: 'lib/observability/server.ts',
    code: 'export const t = process.env.SENTRY_AUTH_TOKEN;\n',
    rule: 'no-restricted-syntax',
    fires: true,
  },
  {
    name: 'next.config.ts reads the auth token',
    file: 'next.config.ts',
    code: 'export const t = process.env.SENTRY_AUTH_TOKEN;\n',
    rule: 'no-restricted-syntax',
    fires: false,
  },
  {
    name: 'lib/deployment.ts names the keys it checks',
    file: 'lib/deployment.ts',
    code: "export const names = ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'NEXT_PUBLIC_POSTHOG_KEY'];\n",
    rule: 'no-restricted-syntax',
    fires: false,
  },
  // ── PostHog door (spec 0004 AC-8) ──
  {
    name: 'a component importing PostHog',
    file: 'components/layout/LocaleSwitcher.tsx',
    code: "import posthog from 'posthog-js';\nexport const p = posthog;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'a server module importing the PostHog server SDK',
    file: 'lib/requests/service.ts',
    code: "import { PostHog } from 'posthog-node';\nexport const p = PostHog;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'lib/analytics is the PostHog door',
    file: 'lib/analytics/client.ts',
    code: "import posthog from 'posthog-js';\nexport const p = posthog;\n",
    rule: 'no-restricted-imports',
    fires: false,
  },
  {
    name: 'the Sentry door may not import PostHog',
    file: 'lib/observability/client.ts',
    code: "import posthog from 'posthog-js';\nexport const p = posthog;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'the PostHog door may not import Sentry',
    file: 'lib/analytics/client.ts',
    code: "import { init } from '@sentry/nextjs';\nexport const i = init;\n",
    rule: 'no-restricted-imports',
    fires: true,
  },
  {
    name: 'the PostHog key read outside its door',
    file: 'instrumentation-client.ts',
    code: 'export const k = process.env.NEXT_PUBLIC_POSTHOG_KEY;\n',
    rule: 'no-restricted-syntax',
    fires: true,
  },
  {
    name: 'the PostHog door reads its key',
    file: 'lib/analytics/client.ts',
    code: 'export const k = process.env.NEXT_PUBLIC_POSTHOG_KEY;\n',
    rule: 'no-restricted-syntax',
    fires: false,
  },
  {
    name: 'the Sentry door may not read the PostHog key',
    file: 'lib/observability/server.ts',
    code: 'export const k = process.env.NEXT_PUBLIC_POSTHOG_KEY;\n',
    rule: 'no-restricted-syntax',
    fires: true,
  },
];

describe('single door lint rules', () => {
  let results: string[][] = [];

  beforeAll(() => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', LINT_ALL], {
      cwd: ROOT,
      input: JSON.stringify(CASES.map(({ code, file }) => ({ code, file }))),
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (run.status !== 0) throw new Error(`ESLint run failed: ${run.stderr}`);
    results = JSON.parse(run.stdout) as string[][];
  }, 120_000);

  it.each(CASES.map((c, index) => ({ ...c, index })))('$name → fires: $fires', ({ index, rule, fires }) => {
    const ids = results[index] ?? [];
    expect(ids.filter((id) => id.startsWith('fatal'))).toEqual([]);
    expect(ids.includes(rule)).toBe(fires);
  });
});
