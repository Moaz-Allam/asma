import 'server-only';

import { z } from 'zod';

import { isPostHogProjectKey, parseEuSentryDsn } from '@/lib/deployment';

/**
 * Environment validation. Fails fast and loudly at server boot (instrumentation.ts).
 *
 * code-standards.md §12: every variable validated at startup; missing means the
 * app does not boot, rather than failing at first use in production.
 *
 * ⚠️ SCOPE — this schema covers only what the CURRENTLY BUILT features consume.
 * `.env.example` lists more (PAYTABS_*…; IYZICO_* joined with 08, EMAIL_* with 13)
 * because it documents the whole system. Those are deliberately NOT validated yet:
 * requiring a PSP key before the PSP adapter exists would stop the app booting for
 * a feature nobody can call.
 *
 * **Each feature adds its own keys here as it lands** — 15 (PSP), 25
 * (notifications). Adding the key to `.env.example` without adding it here means
 * it is silently optional, which is exactly the failure §12 forbids. Keep the two
 * files in step. The money flags are not variables at all: they are
 * `platform_settings` rows per region, read live by `lib/flags` (D70).
 *
 * Which keys a DEPLOYMENT must have is decided in `lib/deployment.ts` (D71), checked
 * at build in `next.config.ts` and at boot in `instrumentation.ts`. This schema only
 * refuses a malformed value when one is present.
 */

const REMOVED_BY_D14 = ['APP_REGION', 'APP_CURRENCY', 'PSP_PROVIDER'] as const;

/** A mail sender (spec 0011-13 R-4): `a@b.c`, or `Name <a@b.c>` with no angle bracket, quote or line break in the name. */
export function isEmailSender(value: string): boolean {
  const address = '[^@\\s<>"]+@[^@\\s<>"]+\\.[^@\\s<>"]+';
  return new RegExp(`^(?:${address}|[^<>"\\r\\n]{1,64} <${address}>)$`).test(value) && value.length <= 254;
}

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

  // ── Deployment (lib/deployment.ts, spec 0004 AC-9) ────────────────────────
  // Marks a local production build or `next start` (CI, e2e). Exactly `1`, or unset. Any other value
  // would silently count as a deployment, so a typo such as `true` is refused here by name.
  APP_LOCAL_ONLY: z.literal('1', 'must be exactly 1, or unset').optional(),

  // ── Error reporting (lib/observability, spec 0004 AC-1, D62) ──────────────
  // Public by design (it ships to the browser). Optional here, so `npm run dev` runs without Sentry;
  // a deployment requires it (lib/deployment.ts). When present it must be the EU ingest DSN.
  NEXT_PUBLIC_SENTRY_DSN: z
    .string()
    .refine((dsn) => parseEuSentryDsn(dsn) !== null, {
      message: 'must be an EU Sentry DSN, https://<key>@o<org>.ingest.de.sentry.io/<project>',
    })
    .optional(),

  // ── Analytics (lib/analytics, spec 0004 AC-6) ─────────────────────────────
  // Public by design. Optional here, required on a deployment. Only a project key (phc_): a personal
  // API key (phx_) would ship full account access to every browser.
  NEXT_PUBLIC_POSTHOG_KEY: z
    .string()
    .refine(isPostHogProjectKey, { message: 'must be a PostHog project key (phc_…), never a personal key' })
    .optional(),

  // ── Bot check (spec 0005 AC-4, D98) ───────────────────────────────────────
  // Public by design. Optional here, required on a deployment. There is no secret to validate: Supabase
  // Auth is the only caller of siteverify, so the app holds none.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),

  // ── The public address (spec 0005 AC-30, lib/seo) ─────────────────────────
  // Empty until the real domain exists (S4). Setting it on production is what turns indexing on, so a
  // wrong shape is refused rather than published in every canonical link.
  APP_SITE_URL: z
    .url()
    .refine((url) => url.startsWith('https://') && !url.endsWith('/'), {
      message: 'must be https, with no trailing slash',
    })
    .optional(),

  // ── This deployment's own address (spec 0011-08 AC-4, AC-21) ─────────────
  // Where the PSP sends the browser back, and the fake card page's host. Optional: unset, it is derived
  // (lib/http/origin.ts). The e2e wrapper sets it to its own port.
  APP_ORIGIN: z
    .url()
    .refine((url) => /^https:\/\/[^/@]+$/.test(url) || /^http:\/\/localhost(:\d{1,5})?$/.test(url), {
      message: 'must be https (or http on localhost), a bare origin with no path and no trailing slash',
    })
    .optional(),

  // ── The PSP door (lib/psp, spec 0011-08 AC-2) ─────────────────────────────
  // `off` (the default) refuses every PSP call; `fake` is the deterministic test PSP; `iyzico` the real
  // one. lib/deployment.ts refuses `fake` on production and `iyzico` without its keys.
  PSP_DRIVER: z.enum(['off', 'fake', 'iyzico']).default('off'),
  // Secrets, read only inside lib/psp (lint). Shape checked when present; required only with `iyzico`.
  IYZICO_API_KEY: z.string().min(1).optional(),
  IYZICO_SECRET_KEY: z.string().min(1).optional(),
  IYZICO_BASE_URL: z
    .url()
    .refine((url) => /^https:\/\/(sandbox-api|api)\.iyzipay\.com$/.test(url), {
      message: 'must be https://sandbox-api.iyzipay.com or https://api.iyzipay.com, with no trailing slash',
    })
    .optional(),
  IYZICO_WEBHOOK_SECRET: z.string().min(1).optional(),

  // ── The relay (lib/relay, spec 0011-08 AC-5) ─────────────────────────────
  // SECRET: the x-relay-secret header pg_net sends (S33). Read only by lib/relay (lint). Without it the
  // relay route answers 404 to everyone.
  RELAY_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),

  // ── The email door (lib/email, spec 0011-13 R-4, AC-1) ───────────────────
  // `off` (the default) sends nothing and ends each mail `email_off`; `fake` appends each mail as one JSON line
  // to EMAIL_FAKE_FILE (the e2e wrapper only); `resend` sends through Resend's REST API. Read only inside
  // lib/email (lint). lib/deployment.ts refuses `fake` on any deployment and `resend` without its key and sender.
  EMAIL_DRIVER: z.enum(['off', 'fake', 'resend']).default('off'),
  // SECRET: the Resend sending key (owner step S5).
  EMAIL_API_KEY: z.string().min(1).optional(),
  // The sender, `Name <address>` or a bare address, such as `Aldebyani <no-reply@domain>` once S4 exists.
  EMAIL_FROM: z
    .string()
    .refine((from) => isEmailSender(from), {
      message:
        'must be an address, or a name and an address in angle brackets: Aldebyani <no-reply@example.com>',
    })
    .optional(),
  // An absolute path; the e2e wrapper's file for the fake driver. Never set on Vercel.
  EMAIL_FAKE_FILE: z.string().min(1).optional(),

  // ── Server only error reporting (spec 0011-08 AC-14, R5) ──────────────────
  // A second Sentry project that no browser ever sees, so nobody can forge a server alert. Unset, the
  // server keeps NEXT_PUBLIC_SENTRY_DSN. Required on a deployment with PSP_DRIVER=iyzico.
  SENTRY_SERVER_DSN: z
    .string()
    .refine((dsn) => parseEuSentryDsn(dsn) !== null, {
      message: 'must be an EU Sentry DSN, https://<key>@o<org>.ingest.de.sentry.io/<project>',
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

/**
 * The Sentry DSN, for server code outside the Sentry door: the /api/e and /api/csp routes (D83).
 * Only the doors, lib/env.ts, lib/deployment.ts and next.config.ts may name the variable itself
 * (spec 0004 AC-8, lint enforced), so everyone else asks here.
 */
export function sentryDsn(): string | undefined {
  return getEnv().NEXT_PUBLIC_SENTRY_DSN;
}

/** The PostHog project key, for the /api/a route (D83). Same rule as `sentryDsn()`. */
export function posthogKey(): string | undefined {
  return getEnv().NEXT_PUBLIC_POSTHOG_KEY;
}

/**
 * The DSN the server reports to (spec 0011-08 AC-14, R5): the server only project when set, else the public
 * one. Never shipped to a browser: this module is server only and the name has no NEXT_PUBLIC_ prefix.
 */
export function sentryServerDsn(): string | undefined {
  return getEnv().SENTRY_SERVER_DSN ?? getEnv().NEXT_PUBLIC_SENTRY_DSN;
}

/** Which PSP driver runs (spec 0011-08 AC-2). `off` unless set. */
export function pspDriver(): Env['PSP_DRIVER'] {
  return getEnv().PSP_DRIVER;
}
