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
