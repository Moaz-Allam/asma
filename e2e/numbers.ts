/**
 * One test number per test per locale project, because no role may delete an account (spec 0005 AC-24).
 * The wrapper resets the database before each run. Every number here has a fixed code in
 * `[auth.sms.test_otp]` in supabase/config.toml, and that file never reaches the cloud (AC-25).
 */

export const TEST_CODE = '123456';
export const WRONG_CODE = '000000';

const PROJECT_DIGIT: Readonly<Record<string, number>> = { ar: 1, tr: 2, en: 3 };

export const NUMBER = {
  customer: 1,
  provider: 2,
  wrongCode: 3,
  reload: 4,
  injection: 5,
  account: 6,
  telemetry: 7,
  roles: 8,
} as const;

/** The national number, as a person types it. */
export function testPhone(project: string, test: keyof typeof NUMBER): string {
  return `555${PROJECT_DIGIT[project]}00000${NUMBER[test]}`;
}
