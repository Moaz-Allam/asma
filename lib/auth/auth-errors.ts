/**
 * Auth's answers, mapped to stable codes the messages catalogue knows (rule 10, spec 0005 AC-5, AC-6).
 * The map comes from real responses: tests/auth-errors.test.ts quotes them. Auth answers the hourly cap
 * and the per phone window with one error code and different text, so the text tells them apart.
 *
 * `report`: the owner should hear about it. Only the SMS cap and failures we cannot explain reach
 * Sentry, and only as a code: the raw message can hold a phone number (AC-22).
 */

export type SendError =
  | 'limit_phone'
  | 'limit_ip'
  | 'limit_sms_cap'
  | 'limit_sends'
  | 'bot_check_failed'
  | 'phone_not_supported'
  | 'send_failed'
  | 'network';

export type CheckError = 'wrong_or_expired' | 'limit_checks' | 'limit_ip' | 'network';

export type Failure<E> = { error: E; report: boolean };

/** The shape of an AuthError, plus whatever else a failed call can throw. */
type AuthFailure = { name?: string; status?: number; code?: string; message?: string };

function isDropped(error: AuthFailure): boolean {
  return error.name === 'AuthRetryableFetchError' || error.name === 'TypeError';
}

export function sendFailure(error: AuthFailure): Failure<SendError> {
  const message = error.message ?? '';
  if (isDropped(error)) return { error: 'network', report: false };
  if (message === 'phone_not_supported') return { error: 'phone_not_supported', report: false };
  if (error.code === 'captcha_failed') return { error: 'bot_check_failed', report: false };
  if (error.code === 'over_request_rate_limit') return { error: 'limit_ip', report: false };
  if (error.code === 'over_sms_send_rate_limit') {
    return /rate limit exceeded/i.test(message)
      ? { error: 'limit_sms_cap', report: true }
      : { error: 'limit_phone', report: false };
  }
  // Twilio Verify's own limit reaches us inside a provider failure, with its error page in the text.
  if (/60203|max send attempts/i.test(message)) return { error: 'limit_sends', report: false };
  return { error: 'send_failed', report: true };
}

export function checkFailure(error: AuthFailure): Failure<CheckError> {
  const message = error.message ?? '';
  if (isDropped(error)) return { error: 'network', report: false };
  if (error.code === 'over_request_rate_limit') return { error: 'limit_ip', report: false };
  if (/60202|max check attempts/i.test(message)) return { error: 'limit_checks', report: false };
  if (error.code === 'otp_expired') return { error: 'wrong_or_expired', report: false };
  return { error: 'network', report: true };
}

/** Spec 0012 AC-2: a password sign in never says whether the phone has an account. */
export type PasswordSignInError = 'bad_credentials' | 'bot_check_failed' | 'limit_ip' | 'network';

/** Spec 0012 AC-5: setting or changing a password. */
export type SetPasswordError = 'weak_password' | 'same_password' | 'reauth_needed' | 'network';

export function passwordSignInFailure(error: AuthFailure): Failure<PasswordSignInError> {
  if (isDropped(error)) return { error: 'network', report: false };
  // An unknown phone, a wrong password and an account with no password yet all answer one of these two.
  if (error.code === 'invalid_credentials' || error.code === 'phone_not_confirmed') {
    return { error: 'bad_credentials', report: false };
  }
  if (error.code === 'captcha_failed') return { error: 'bot_check_failed', report: false };
  if (error.code === 'over_request_rate_limit') return { error: 'limit_ip', report: false };
  return { error: 'network', report: true };
}

export function setPasswordFailure(error: AuthFailure): Failure<SetPasswordError> {
  if (isDropped(error)) return { error: 'network', report: false };
  if (error.code === 'weak_password') return { error: 'weak_password', report: false };
  if (error.code === 'same_password') return { error: 'same_password', report: false };
  if (error.code === 'reauthentication_needed') return { error: 'reauth_needed', report: false };
  return { error: 'network', report: true };
}
