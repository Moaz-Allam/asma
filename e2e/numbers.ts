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
  notices: 9,
  // Position 02 (spec 0006 AC-28): each project has its own providers and its own admin, because one
  // queue is shared and the projects run in parallel.
  onboarding: 10,
  admin: 11,
  suspended: 12,
  gateCustomer: 13,
  reviewer: 14,
} as const;

/**
 * The national number, as a person types it. The last part is two digits (spec 0006): `01` gives the
 * same string as before, and 10 and on still give 10 digits.
 */
export function testPhone(project: string, test: keyof typeof NUMBER): string {
  return `555${PROJECT_DIGIT[project]}0000${String(NUMBER[test]).padStart(2, '0')}`;
}

/** The same number in E.164, as profiles.phone stores it. */
export function testE164(project: string, test: keyof typeof NUMBER): string {
  return `+90${testPhone(project, test)}`;
}
