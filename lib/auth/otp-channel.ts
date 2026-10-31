import { createSupabaseBrowser } from '@/lib/db/client';

import { checkFailure, sendFailure, type CheckError, type Failure, type SendError } from './auth-errors';

/**
 * Send and check a sign in code, from the browser straight to Supabase Auth (D98). Auth is public
 * anyway, so the checks that truly hold live inside it, and no Server Action of ours stands in the way.
 * Supabase Auth is the only Turnstile checker: a token works once, so the app never calls siteverify.
 *
 * The swappable shape stays (D55, architecture.md): one `send` and `check`, with one phone adapter.
 * Its local fake is the local stack with test numbers (`[auth.sms.test_otp]` in supabase/config.toml).
 */

export type OtpResult<E> = { ok: true } | ({ ok: false } & Failure<E>);

export type OtpChannel = {
  send(target: string, captchaToken: string): Promise<OtpResult<SendError>>;
  check(target: string, code: string): Promise<OtpResult<CheckError>>;
};

const phoneChannel: OtpChannel = {
  async send(phone, captchaToken) {
    try {
      const { error } = await createSupabaseBrowser().auth.signInWithOtp({
        phone,
        options: { captchaToken, channel: 'sms' },
      });
      return error ? { ok: false, ...sendFailure(error) } : { ok: true };
    } catch (error) {
      return { ok: false, ...sendFailure(error instanceof Error ? error : {}) };
    }
  },

  async check(phone, code) {
    try {
      const { error } = await createSupabaseBrowser().auth.verifyOtp({ phone, token: code, type: 'sms' });
      return error ? { ok: false, ...checkFailure(error) } : { ok: true };
    } catch (error) {
      return { ok: false, ...checkFailure(error instanceof Error ? error : {}) };
    }
  },
};

export const sendCode = phoneChannel.send;
export const checkCode = phoneChannel.check;
