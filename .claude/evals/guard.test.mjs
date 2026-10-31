#!/usr/bin/env node
/**
 * Regression test for .claude/hooks/guard.mjs
 *
 * A guardrail that stops firing is worse than no guardrail, because everyone
 * still believes it is working. This asserts every rule still denies what it
 * must, and — just as importantly — that compliant code still passes.
 *
 * Run:  node .claude/evals/guard.test.mjs
 * CI:   same, non-zero exit on failure.
 */

import { spawnSync } from 'node:child_process';

const HOOK = '.claude/hooks/guard.mjs';

/**
 * A case sends `content` with Write, `edit` (one new_string) with Edit, or `edits` (several
 * new_strings) with MultiEdit. The guard never reads old_string.
 * @type {{name:string, expect:string|null, path:string, content?:string, edit?:string, edits?:string[]}[]}
 */
const CASES = [
  // ---- must DENY ---------------------------------------------------------
  {
    name: 'PSP imported inside a Server Action',
    expect: 'psp-in-request-path',
    path: 'actions/unlock.ts',
    content: 'import { getPaymentProvider } from "@/lib/psp";',
  },
  {
    name: 'PSP SDK imported directly outside lib/psp',
    expect: 'psp-in-request-path',
    path: 'actions/payments.ts',
    content: 'import iyzipay from "../vendor/iyzico/client";',
  },
  {
    name: 'float arithmetic in the pricing engine',
    expect: 'float-money',
    path: 'lib/pricing/engine.ts',
    content: 'const total = (base * factor).toFixed(2);',
  },
  {
    name: 'ledger row mutated via the query builder',
    expect: 'ledger-mutation',
    path: 'lib/money/repair.ts',
    content: 'await db.from("ledger_entries").update({ debit: 0 });',
  },
  {
    name: 'ledger row mutated via raw SQL in a migration',
    expect: 'ledger-mutation',
    path: 'supabase/migrations/0100_fix.sql',
    content: 'UPDATE ledger_entries SET credit = 0 WHERE id = $1;',
  },
  {
    name: 'a real UPDATE after a SQL comment line',
    expect: 'ledger-mutation',
    path: 'supabase/migrations/0101_fix.sql',
    content: '-- correct the posting\nUPDATE ledger_entries SET credit = 0;',
  },
  {
    name: '// in SQL is text, so it cannot hide the code after it',
    expect: 'ledger-mutation',
    path: 'supabase/migrations/0102_fix.sql',
    content: 'SELECT $q$a//b$q$; UPDATE ledger_entries SET credit = 0;',
  },
  {
    name: 'Edit: a ratings UPDATE in a migration fragment',
    expect: 'ledger-mutation',
    path: 'supabase/migrations/0103_fix.sql',
    edit: 'UPDATE ratings SET stars = 5 WHERE id = $1;',
  },
  {
    name: 'commission netted instead of posted as its own leg',
    expect: 'commission-netted',
    path: 'lib/money/post.ts',
    content: 'const escrowAmount = price - commission;',
  },
  {
    name: 'CREATE TABLE without enabling RLS in the same migration',
    expect: 'rls-missing-on-new-table',
    path: 'supabase/migrations/0002_requests.sql',
    content: 'CREATE TABLE requests (id uuid PRIMARY KEY);',
  },
  {
    name: 'multi-table migration where only one table gets RLS',
    expect: 'rls-missing-on-new-table',
    path: 'supabase/migrations/0003_catalog.sql',
    content:
      'CREATE TABLE zones (id uuid PRIMARY KEY);\n' +
      'ALTER TABLE zones ENABLE ROW LEVEL SECURITY;\n' +
      'CREATE TABLE addons (id uuid PRIMARY KEY);',
  },
  {
    name: 'RLS enabled only inside a SQL comment does not count',
    expect: 'rls-missing-on-new-table',
    path: 'supabase/migrations/0006_zones.sql',
    content: 'CREATE TABLE zones (id uuid PRIMARY KEY);\n-- ALTER TABLE zones ENABLE ROW LEVEL SECURITY;',
  },
  {
    name: "server-only module missing its import 'server-only'",
    expect: 'server-only-missing',
    path: 'lib/money/ledger.ts',
    content: 'export function post() {}',
  },
  {
    name: 'admin-authored expression evaluated',
    expect: 'code-execution',
    path: 'lib/pricing/formula.ts',
    content: 'const fn = new Function("answers", formula.expression);',
  },
  {
    name: 'secret exposed through NEXT_PUBLIC_',
    expect: 'public-secret',
    path: 'lib/env.ts',
    content: 'const k = process.env.NEXT_PUBLIC_PSP_SECRET_KEY;',
  },
  {
    name: 'service_role client reached from a component',
    expect: 'service-role-in-client',
    path: 'components/features/admin/Reports.tsx',
    content: 'import { createSupabaseAdmin } from "@/lib/db/admin";',
  },
  {
    name: "select('*') risking a gated column",
    expect: 'select-star',
    path: 'actions/requests.ts',
    content: 'const { data } = await supabase.from("requests").select("*");',
  },
  {
    name: 'a TS line starting with -- is code, not a SQL comment',
    expect: 'select-star',
    path: 'lib/db/requests.ts',
    content: 'let n = 3;\n--n; const { data } = await supabase.from("requests").select("*");',
  },
  {
    name: 'auth token written to localStorage',
    expect: 'client-storage-for-trust',
    path: 'components/features/auth/Login.tsx',
    content: 'localStorage.setItem("session_token", t);',
  },
  {
    name: 'middleware.ts created instead of proxy.ts',
    expect: 'middleware-filename',
    path: 'middleware.ts',
    content: 'export function middleware() {}',
  },
  {
    name: 'colours defined in tailwind.config',
    expect: 'colours-in-tailwind-config',
    path: 'tailwind.config.ts',
    content: 'export default { theme: { colors: { brand: "#123456" } } };',
  },
  {
    name: 'raw hex in a component',
    expect: 'hardcoded-hex',
    path: 'components/shared/Badge.tsx',
    content: 'const style = { color: "#101828" };',
  },
  {
    name: 'shadcn init writes a generated palette into globals.css',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: ':root { --background: oklch(1 0 0); --primary: oklch(0.21 0.006 285.9); }',
  },
  {
    name: 'shadcn palette as written to disk: one indented custom property per line',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: ':root {\n  --background: oklch(1 0 0);\n  --primary: oklch(0.21 0.006 285.9);\n}',
  },
  {
    name: 'a semantic token holding a raw colour instead of a ramp reference',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: '@theme inline {\n  --color-surface: var(--ramp-white);\n  --color-accent: #0f3a73;\n}',
  },
  {
    name: 'globals.css: a ramp cannot carry a second declaration on its line',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: ':root {\n  --ramp-white: #ffffff; --color-surface: #000000;\n}',
  },
  {
    name: 'globals.css: a placeholder comment on an ordinary rule is not the escape',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: 'body {\n  background: #ff0000; /* placeholder */\n}',
  },
  {
    name: 'globals.css: a real brand value marked placeholder is not the escape',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: '@theme {\n  --color-accent: #0f3a73; /* placeholder */\n}',
  },
  {
    name: 'globals.css: the placeholder escape is gone, so a neutral grey is refused like any colour',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: '@theme {\n  --color-surface: oklch(1 0 0); /* placeholder */\n}',
  },
  {
    name: 'globals.css: the ::placeholder selector is not the escape',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: 'input::placeholder { color: #9ca3af; }',
  },
  {
    name: 'globals.css: a token NAMED placeholder is not the escape',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    content: '@theme inline {\n  --color-text-placeholder: #9ca3af;\n}',
  },
  {
    name: 'globals.css Edit: a semantic token given a raw colour',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    edit: '  --color-accent: #0f3a73;',
  },
  {
    name: 'globals.css Edit: // is not a comment in CSS, so it cannot hide a declaration',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    edit: '  //;--color-accent: #0f3a73;',
  },
  {
    name: 'globals.css MultiEdit: a ramp fragment cannot cover the next fragment',
    expect: 'brand-value-in-globals',
    path: 'app/globals.css',
    edits: ['  --ramp-white: #ffffff', '  --color-accent: #ff0000'],
  },
  {
    name: 'raw Tailwind palette class',
    expect: 'raw-tailwind-palette',
    path: 'components/shared/Card.tsx',
    content: 'const c = "bg-gray-100 text-slate-700";',
  },
  {
    name: 'arbitrary numeric value',
    expect: 'arbitrary-value',
    path: 'components/layout/Navbar.tsx',
    content: 'const c = "w-[437px] p-[13px]";',
  },
  {
    name: 'Turkish locale case-fold on an identifier',
    expect: 'turkish-case-fold',
    path: 'lib/auth/session.ts',
    content: 'const key = email.toLocaleLowerCase("tr-TR");',
  },
  {
    name: 'hardcoded Arabic copy in a component',
    expect: 'hardcoded-locale-string',
    path: 'components/features/requests/RequestForm.tsx',
    content: 'const msg = "تم نشر طلبك";',
  },
  {
    name: 'physical direction utility in an RTL app',
    expect: 'physical-direction',
    path: 'components/features/requests/RequestCard.tsx',
    content: 'const c = "ml-4 text-left border-l";',
  },

  // ---- must PASS (false-positive guards) ---------------------------------
  {
    name: 'compliant component using semantic tokens and logical properties',
    expect: null,
    path: 'components/shared/MoneyDisplay.tsx',
    content: 'const c = "bg-surface ms-4 ps-2 text-text-primary rounded-xl p-6 border-border";',
  },
  {
    name: 'shadcn arbitrary VARIANT selectors are legitimate',
    expect: null,
    path: 'components/ui/button.tsx',
    content: 'const c = "[&_svg]:size-4 [&>span]:hidden data-[state=open]:bg-accent";',
  },
  {
    name: 'the relay worker is allowed to call the PSP',
    expect: null,
    path: 'supabase/functions/outbox-relay/index.ts',
    content: 'import { getPaymentProvider } from "@/lib/psp";',
  },
  {
    name: 'lib/psp may import its own implementations',
    expect: null,
    path: 'lib/psp/index.ts',
    content: "import 'server-only';\nimport { Iyzico } from './iyzico/client';",
  },
  {
    name: 'explicit column list',
    expect: null,
    path: 'actions/requests.ts',
    content: 'await supabase.from("requests").select("id, zone_id, fixed_price");',
  },
  {
    name: 'a doc comment quoting a forbidden pattern must not trip',
    expect: null,
    path: 'lib/money/money.ts',
    content:
      "import 'server-only';\n" +
      '// Never use ml-4 or #101828 or eval() here.\n' +
      '/* bg-gray-100 is banned */\nexport const x = 1;',
  },
  {
    name: 'globals.css: several ramps on one line, each its own declaration',
    expect: null,
    path: 'app/globals.css',
    content: ':root {\n  --ramp-primary-900: #0f3a73; --ramp-primary-700: #1e5fb3;\n}',
  },
  {
    name: 'globals.css: a colour quoted in a comment is prose',
    expect: null,
    path: 'app/globals.css',
    content: '/* Brand navy is #0f3a73 (ui-tokens.md §2) */\n:root {\n  --ramp-primary-900: #0f3a73;\n}',
  },
  {
    name: 'globals.css Edit: a whole ramp declaration',
    expect: null,
    path: 'app/globals.css',
    edit: '  --ramp-primary-900: #123456;',
  },
  {
    name: 'a SQL comment quoting UPDATE ledger_entries next to an INSERT',
    expect: null,
    path: 'supabase/migrations/0007_post.sql',
    content:
      '-- never UPDATE ledger_entries; corrections are new rows\nINSERT INTO ledger_entries (id) VALUES (1);',
  },
  {
    name: 'Edit: an indented SQL comment quoting UPDATE ratings',
    expect: null,
    path: 'supabase/migrations/0008_ratings.sql',
    edit: 'SELECT 1;\n    -- UPDATE ratings is revoked; hide a rating instead\nSELECT 2;',
  },
  {
    name: 'Edit: the server-only check needs the whole file, so a fragment never trips it',
    expect: null,
    path: 'lib/money/ledger.ts',
    edit: 'export function post() {}',
  },
  {
    name: 'the --ramp-* palette block holds the real colours; tokens reference it',
    expect: null,
    path: 'app/globals.css',
    content:
      ':root {\n  --ramp-primary-900: #0f3a73;\n  --ramp-white: #ffffff;\n  --ramp-shadow: rgb(15 58 115 / 0.18);\n}\n' +
      '@theme inline {\n  --color-accent: var(--ramp-primary-900);\n  --color-surface: var(--ramp-white);\n' +
      '  --shadow-overlay: 0 20px 50px var(--ramp-shadow);\n}',
  },
  {
    name: 'border-red is not border-r',
    expect: null,
    path: 'components/shared/ErrorState.tsx',
    content: 'const c = "border-error text-error-foreground";',
  },
  {
    name: 'a non-source file is ignored',
    expect: null,
    path: 'README.md',
    content: 'Use ml-4 and #ffffff and eval() freely in prose.',
  },
  {
    name: 'a spec under docs/ may quote a forbidden secret name',
    expect: null,
    path: 'D:/work/web/asma/docs/specs/0004-sign-in.md',
    content: 'Never name a variable NEXT_PUBLIC_SERVICE_ROLE_KEY; the service role stays server side.',
  },
  {
    name: 'a page in a docs ROUTE is code and stays guarded',
    expect: 'physical-direction',
    path: 'D:/work/web/asma/app/[locale]/docs/page.tsx',
    content: 'const c = "ml-4 text-text-primary";',
  },
  {
    name: 'migration that creates a table AND enables RLS',
    expect: null,
    path: 'supabase/migrations/0004_applications.sql',
    content:
      'CREATE TABLE applications (id uuid PRIMARY KEY);\n' +
      'ALTER TABLE applications ENABLE ROW LEVEL SECURITY;\n' +
      'CREATE POLICY own_rows ON applications FOR SELECT USING (provider_id = (select auth.uid()));',
  },
  {
    name: 'migration that only alters an existing table',
    expect: null,
    path: 'supabase/migrations/0005_add_column.sql',
    content: 'ALTER TABLE requests ADD COLUMN answers jsonb;',
  },
  {
    name: "server-only module that declares import 'server-only'",
    expect: null,
    path: 'lib/pricing/engine.ts',
    content: "import 'server-only';\nexport function price() {}",
  },
  {
    name: 'type declaration files are exempt from server-only',
    expect: null,
    path: 'lib/psp/types.d.ts',
    content: 'export interface PaymentProvider {}',
  },
  {
    name: 'locale-independent toLowerCase on an identifier is correct',
    expect: null,
    path: 'lib/auth/session.ts',
    content: 'const key = email.toLowerCase();',
  },
  {
    name: 'Arabic belongs in the message catalogue',
    expect: null,
    path: 'messages/ar.json',
    content: '{ "RequestForm": { "posted": "تم نشر طلبك" } }',
  },
  {
    name: 'component pulling copy from the catalogue',
    expect: null,
    path: 'components/features/requests/RequestForm.tsx',
    content: 'const t = useTranslations("RequestForm");\nreturn <p>{t("posted")}</p>;',
  },
];

let pass = 0;
const failures = [];

function payloadFor(c) {
  if (c.edits)
    return {
      tool_name: 'MultiEdit',
      tool_input: { file_path: c.path, edits: c.edits.map((s) => ({ old_string: '-', new_string: s })) },
    };
  if (c.edit !== undefined)
    return { tool_name: 'Edit', tool_input: { file_path: c.path, old_string: '-', new_string: c.edit } };
  return { tool_name: 'Write', tool_input: { file_path: c.path, content: c.content } };
}

for (const c of CASES) {
  const payload = JSON.stringify(payloadFor(c));
  const r = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  const denied = r.stdout.includes('"permissionDecision":"deny"');
  const ruleFired = denied ? /\[([a-z-]+)\]/.exec(r.stdout)?.[1] : null;

  if (c.expect === null) {
    if (denied) failures.push(`${c.name}\n    expected: pass\n    got: denied by [${ruleFired}]`);
    else pass++;
  } else if (!denied) {
    failures.push(`${c.name}\n    expected: deny [${c.expect}]\n    got: passed`);
  } else if (!r.stdout.includes(`[${c.expect}]`)) {
    failures.push(`${c.name}\n    expected: deny [${c.expect}]\n    got: deny [${ruleFired}]`);
  } else {
    pass++;
  }
}

console.log(`\nguard.mjs — ${pass}/${CASES.length} passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n`);
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log('All rules enforced, no false positives.\n');
