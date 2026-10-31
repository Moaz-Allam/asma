import { describe, expect, it } from 'vitest';

import { REMOVED_BY_D14, parseEnv } from '@/lib/env';

const valid = {
  NODE_ENV: 'test',
  APP_DEFAULT_LOCALE: 'ar',
  APP_SUPPORTED_LOCALES: 'ar,tr,en',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SUPABASE_DB_POOL_URL:
    'postgresql://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
} as NodeJS.ProcessEnv;

describe('environment fails fast and loudly', () => {
  it('accepts a complete environment', () => {
    expect(parseEnv(valid).APP_DEFAULT_LOCALE).toBe('ar');
  });

  it('refuses a missing variable', () => {
    const { NEXT_PUBLIC_SUPABASE_URL: _omitted, ...rest } = valid;
    expect(() => parseEnv(rest as NodeJS.ProcessEnv)).toThrow(/Invalid environment/);
  });

  it('refuses the direct connection — serverless must use the transaction pooler', () => {
    expect(() =>
      parseEnv({ ...valid, SUPABASE_DB_POOL_URL: 'postgresql://u:p@db.example.com:5432/postgres' }),
    ).toThrow(/POOLER/);
  });

  it('allows the pool url to be absent until a direct Postgres consumer exists (D38)', () => {
    const { SUPABASE_DB_POOL_URL: _omitted, ...rest } = valid;
    expect(parseEnv(rest as NodeJS.ProcessEnv).SUPABASE_DB_POOL_URL).toBeUndefined();
  });

  it('treats an empty value as unset: optional passes, required fails', () => {
    expect(parseEnv({ ...valid, SUPABASE_DB_POOL_URL: '' }).SUPABASE_DB_POOL_URL).toBeUndefined();
    expect(() => parseEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('refuses a pooler url that has not disabled prepared statements', () => {
    expect(() =>
      parseEnv({ ...valid, SUPABASE_DB_POOL_URL: 'postgresql://u:p@x.pooler.supabase.com:6543/postgres' }),
    ).toThrow(/pgbouncer=true/);
  });

  it('accepts the Sentry DSN only on the EU ingest, and lets it be absent locally (D62)', () => {
    const eu = 'https://key@o123.ingest.de.sentry.io/456';
    expect(parseEnv({ ...valid, NEXT_PUBLIC_SENTRY_DSN: eu }).NEXT_PUBLIC_SENTRY_DSN).toBe(eu);
    expect(parseEnv(valid).NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(() =>
      parseEnv({ ...valid, NEXT_PUBLIC_SENTRY_DSN: 'https://key@o123.ingest.us.sentry.io/456' }),
    ).toThrow(/NEXT_PUBLIC_SENTRY_DSN/);
  });

  it('accepts APP_LOCAL_ONLY only as exactly 1, or unset (spec 0004 AC-9)', () => {
    expect(parseEnv({ ...valid, APP_LOCAL_ONLY: '1' }).APP_LOCAL_ONLY).toBe('1');
    expect(parseEnv(valid).APP_LOCAL_ONLY).toBeUndefined();
    expect(parseEnv({ ...valid, APP_LOCAL_ONLY: '' }).APP_LOCAL_ONLY).toBeUndefined();
    expect(() => parseEnv({ ...valid, APP_LOCAL_ONLY: 'true' })).toThrow(/APP_LOCAL_ONLY/);
  });
});

describe('the pre-D14 deployment model cannot come back', () => {
  it.each(REMOVED_BY_D14)('rejects %s if reintroduced', (key) => {
    expect(() => parseEnv({ ...valid, [key]: 'TR' })).toThrow(/decision D14 removed/);
  });
});
