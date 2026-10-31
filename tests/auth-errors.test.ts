import { describe, expect, it } from 'vitest';

import { checkFailure, sendFailure } from '@/lib/auth/auth-errors';

/**
 * Spec 0005 AC-5, AC-6: Auth's answers mapped to stable codes. The cases marked `real` are the bodies the
 * local Auth server returned on 2026-10-31 (status, error_code, msg). The per IP limit and the Twilio
 * Verify limits need the cloud project; verify.md records them on the preview.
 */

const failure = (status: number, code: string, message: string) => ({ status, code, message });

describe('sendFailure', () => {
  it.each([
    [
      'real: the per phone window',
      failure(
        429,
        'over_sms_send_rate_limit',
        'For security purposes, you can only request this after 42 seconds.',
      ),
      'limit_phone',
    ],
    [
      'real: the hourly cap',
      failure(429, 'over_sms_send_rate_limit', 'SMS rate limit exceeded'),
      'limit_sms_cap',
    ],
    ['real: the hook refusal', failure(400, 'unknown', 'phone_not_supported'), 'phone_not_supported'],
    [
      'real: a provider failure',
      failure(422, 'sms_send_failed', 'Error sending confirmation OTP to provider: Authentication Error'),
      'send_failed',
    ],
    ['the per IP limit', failure(429, 'over_request_rate_limit', 'Request rate limit reached'), 'limit_ip'],
    [
      'a rejected bot check',
      failure(400, 'captcha_failed', 'captcha protection: request disallowed'),
      'bot_check_failed',
    ],
    [
      'Twilio: too many sends',
      failure(
        422,
        'sms_send_failed',
        'Max send attempts reached More information: https://www.twilio.com/docs/errors/60203',
      ),
      'limit_sends',
    ],
  ])('%s', (_name, error, expected) => {
    expect(sendFailure(error).error).toBe(expected);
  });

  it('marks only what the owner must see', () => {
    expect(sendFailure(failure(429, 'over_sms_send_rate_limit', 'SMS rate limit exceeded')).report).toBe(
      true,
    );
    expect(sendFailure(failure(422, 'sms_send_failed', 'boom')).report).toBe(true);
    expect(sendFailure(failure(500, 'unexpected_failure', 'boom'))).toEqual({
      error: 'send_failed',
      report: true,
    });
    expect(
      sendFailure(failure(429, 'over_sms_send_rate_limit', 'only request this after 9 seconds')).report,
    ).toBe(false);
    expect(sendFailure(failure(400, 'unknown', 'phone_not_supported')).report).toBe(false);
  });

  it('treats a dropped connection as the network, not as a fault', () => {
    expect(sendFailure({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toEqual({
      error: 'network',
      report: false,
    });
  });
});

describe('checkFailure', () => {
  it.each([
    [
      'real: wrong or expired',
      failure(403, 'otp_expired', 'Token has expired or is invalid'),
      'wrong_or_expired',
    ],
    ['the per IP limit', failure(429, 'over_request_rate_limit', 'Request rate limit reached'), 'limit_ip'],
    [
      'Twilio: too many checks',
      failure(403, 'otp_expired', 'Max check attempts reached https://www.twilio.com/docs/errors/60202'),
      'limit_checks',
    ],
  ])('%s', (_name, error, expected) => {
    expect(checkFailure(error)).toEqual({ error: expected, report: false });
  });

  it('shows anything else as a plain retry, and reports it', () => {
    expect(checkFailure(failure(500, 'unexpected_failure', 'boom'))).toEqual({
      error: 'network',
      report: true,
    });
  });

  it('treats a dropped connection as the network', () => {
    expect(checkFailure({ name: 'AuthRetryableFetchError', status: 503, message: 'x' })).toEqual({
      error: 'network',
      report: false,
    });
  });
});
