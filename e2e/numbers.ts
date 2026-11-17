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
  // Position 03 (spec 0007 AC-25): each project builds its own catalog with its own admin and names.
  catalogAdmin: 15,
  catalogCustomer: 16,
  catalogProvider: 17,
  // Position 04 (spec 0008 AC-26): a customer who posts, another customer and a provider who are kept out.
  requestCustomer: 18,
  requestOther: 19,
  requestProvider: 20,
  // Position 05 (spec 0009 AC-24): two approved providers and the customer whose request they see.
  feedProvider: 21,
  feedRival: 22,
  feedCustomer: 23,
  // Position 06 (spec 0010 AC-20): a customer who chooses, the chosen provider and the other.
  chooseCustomer: 24,
  chooseProvider: 25,
  chooseRival: 26,
  // Position 09 (spec 0011-09 AC-15): the customer of each of the two payment tests, and another customer who
  // gets 404 on the first one's pay, return and receipt pages. The provider is written by SQL: no sign in.
  payCustomer: 27,
  payOther: 28,
  payCustomerB: 29,
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
