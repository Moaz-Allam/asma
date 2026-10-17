import 'server-only';

import { z } from 'zod';

/**
 * Environment validation. Fails fast and loudly at server boot (instrumentation.ts).
 *
 * code-standards.md §12: every variable validated at startup; missing means the
 * app does not boot, rather than failing at first use in production.
 *
 * ⚠️ SCOPE — this schema covers only what the CURRENTLY BUILT features consume.
 * `.env.example` lists more (IYZICO_*, PAYTABS_*, SMS_API_KEY, EMAIL_API_KEY, the
 * feature flags…) because it documents the whole system. Those are deliberately
 * NOT validated yet: requiring a PSP key before the PSP adapter exists would stop
 * the app booting for a feature nobody can call.
 *
 * **Each feature adds its own keys here as it lands** — 15 (PSP), 25
 * (notifications), 42 (flags). Adding the key to `.env.example` without adding it
 * here means it is silently optional, which is exactly the failure §12 forbids.
 * Keep the two files in step.
 */

const REMOVED_BY_D14 = ['APP_REGION', 'APP_CURRENCY', 'PSP_PROVIDER'] as const;

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── i18n (context/i18n.md) ────────────────────────────────────────────────
  APP_DEFAULT_LOCALE: z.enum(['ar', 'tr', 'en']),
  APP_SUPPORTED_LOCALES: z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()))
    .pipe(z.array(z.enum(['ar', 'tr', 'en'])).nonempty()),

  // ── Supabase ──────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Transaction-mode pooler (port 6543) with prepared statements disabled.
  // architecture.md §33: the direct connection is for migrations only, and
  // serverless on a direct connection exhausts Postgres under the launch spike.
  //
  // Optional until the first direct Postgres consumer exists (D38): nothing reads
  // it yet, and requiring it stopped the local stack and the e2e build from
  // booting without cloud values. When present, a wrong shape is still refused.
  // The position that adds the consumer makes it required again.
  SUPABASE_DB_POOL_URL: z
    .string()
    .min(1)
    .refine((u) => u.startsWith('postgresql://'), { message: 'must be a postgresql:// connection string' })
    .refine((u) => u.includes(':6543'), {
      message: 'must be the TRANSACTION-MODE POOLER url (port 6543), not the direct connection',
    })
    .refine((u) => u.includes('pgbouncer=true'), {
      message: 'must set pgbouncer=true so prepared statements are disabled',
    })
    .optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  // An empty value means "not set". The e2e wrapper blanks every documented variable so a
  // developer's cloud env file can never fill one in; a blank required variable still fails below.
  const source = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '')) as NodeJS.ProcessEnv;

  // D14 — region is a COLUMN on the owning row, not a deployment-wide constant.
  // A global here would be trusted as truth and silently mis-scope every query
  // the moment the second market goes live, so its presence is a hard error
  // rather than something quietly ignored.
  const reintroduced = REMOVED_BY_D14.filter((k) => source[k] !== undefined);
  if (reintroduced.length > 0) {
    throw new Error(
      `Environment defines ${reintroduced.join(', ')}, which decision D14 removed. ` +
        'Both regions run from ONE deployment: read `region` from the owning row and derive ' +
        'currency and PSP from it. See context/architecture.md §4 (Regions).',
    );
  }

  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${detail}\n\nSee .env.example.`);
  }
  return result.data;
}

export { parseEnv, EnvSchema, REMOVED_BY_D14 };

let cached: Env | undefined;

/**
 * The validated environment.
 *
 * Cached after the first call. `instrumentation.ts` calls this once at server
 * boot, which is what makes validation genuinely fail-fast — the process refuses
 * to start rather than failing at some later first use in production.
 *
 * It is a function rather than a module-level constant on purpose: a top-level
 * `parseEnv()` would run on any import, including from a test or a tool that has
 * no business booting the app, and would fail for the wrong reason.
 */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}
