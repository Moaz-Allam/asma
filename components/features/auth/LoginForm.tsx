'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';

import { signOut } from '@/actions/account';
import { BotCheck } from '@/components/features/auth/BotCheck';
import { CodeField } from '@/components/features/auth/CodeField';
import { PhoneField } from '@/components/features/auth/PhoneField';
import { SupportLink } from '@/components/shared/SupportLink';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import type { AnalyticsEvents } from '@/lib/analytics/events';
import type { CheckError, SendError } from '@/lib/auth/auth-errors';
import { CODE_LENGTH, RESEND_SECONDS } from '@/lib/auth/limits';
import {
  clearLoginStep,
  parseLoginStep,
  rawLoginStep,
  saveLoginStep,
  type LoginStep,
} from '@/lib/auth/login-step';
import { checkCode, sendCode } from '@/lib/auth/otp-channel';
import { getPathname, Link } from '@/lib/i18n/navigation';
import { reportClientError } from '@/lib/observability/client';
import { normalizeForRegions, type PhoneRejection } from '@/lib/region/phone';

/**
 * Sign in, two steps on one page (spec 0005 AC-1, AC-2, AC-4, AC-5, AC-6). New and returning numbers see
 * the same form, so nothing reveals whether a number has an account. The phone stays in client state,
 * never the URL. After a code, `/continue` decides where to land, with a full page load so the server
 * reads the new session.
 *
 * Spec 0012: this is the code mode (`?mode=code`), for a new account and a password reset (`reset=1`, kept with the
 * phone in `login_step`, carried to `/continue`). A signed in visitor who asks for a reset is asked to sign out on
 * this device first (`signOutFirst`, a button, never on load), so a reset always starts from a fresh code session.
 */

type FormError = PhoneRejection | SendError | CheckError | null;

type Limit = AnalyticsEvents['code_limited']['limit'];

function isLimit(error: SendError | CheckError): error is Limit {
  return error.startsWith('limit_');
}

function noteFailure(error: SendError | CheckError, report: boolean) {
  if (isLimit(error)) track('code_limited', { limit: error });
  // By stable code only: the raw message can hold the phone number (AC-22).
  if (report) reportClientError(new Error(`auth_${error}`));
}

const noSubscription = () => () => undefined;

/** The saved step, after hydration: the server has no sessionStorage, so it renders the phone step. */
function useSavedStep(): LoginStep | null {
  const raw = useSyncExternalStore(noSubscription, rawLoginStep, () => null);
  return useMemo(() => parseLoginStep(raw), [raw]);
}

function formatWait(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type Props = {
  dialCodes: readonly string[];
  siteKey: string | undefined;
  nonce: string | undefined;
  next: string | null;
  asProvider: boolean;
  supportWhatsapp: string | null | undefined;
  reset: boolean;
  signOutFirst: boolean;
};

export function LoginForm({
  dialCodes,
  siteKey,
  nonce,
  next,
  asProvider,
  supportWhatsapp,
  reset: resetInUrl,
  signOutFirst,
}: Props) {
  const t = useTranslations('Login');
  const locale = useLocale();
  const dialCode = dialCodes[0] ?? '';

  const saved = useSavedStep();
  const [sent, setSent] = useState<LoginStep | null>(null);
  const [chosenStep, setChosenStep] = useState<'phone' | 'code' | null>(null);
  const live = sent ?? saved;
  const step = chosenStep ?? (live ? 'code' : 'phone');
  const phone = live?.phone ?? '';
  const sentAt = live?.sentAt ?? 0;
  const reset = resetInUrl || live?.reset === true;
  const [signedOut, setSignedOut] = useState(!signOutFirst);

  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError>(null);
  const [now, setNow] = useState(0);

  const onToken = useCallback((value: string | null) => setToken(value), []);

  // A click, never the page load: a posted `?reset=1` link must not sign anyone out (security review 2026-11-21).
  const [signingOut, setSigningOut] = useState(false);
  async function signOutForReset() {
    setSigningOut(true);
    // A failed sign out still goes on: the code sign in replaces this device's session anyway.
    await signOut().catch(() => undefined);
    setSigningOut(false);
    setSignedOut(true);
  }

  useEffect(() => {
    if (step !== 'code') return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [step]);

  const elapsed = Math.max(0, Math.floor((now - sentAt) / 1000));
  const waitSeconds = Math.max(0, RESEND_SECONDS - elapsed);

  async function send(target: string) {
    if (!token || !signedOut) return;
    setBusy(true);
    setError(null);
    const result = await sendCode(target, token);
    // A token works once, whatever the answer was.
    setAttempt((count) => count + 1);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      noteFailure(result.error, result.report);
      return;
    }
    const time = Date.now();
    track('code_requested', {});
    const step = reset ? { phone: target, sentAt: time, reset: true } : { phone: target, sentAt: time };
    saveLoginStep(step);
    setSent(step);
    setCode('');
    setChosenStep('code');
  }

  function onSubmitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = new FormData(event.currentTarget).get('phone');
    const normalized = normalizeForRegions(typeof typed === 'string' ? typed : '', dialCodes);
    if (!normalized.ok) {
      setError(normalized.reason);
      track('phone_rejected', { reason: normalized.reason });
      return;
    }
    void send(normalized.phone);
  }

  async function verify(value: string) {
    if (value.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    const result = await checkCode(phone, value);
    if (!result.ok) {
      setBusy(false);
      setCode('');
      setError(result.error);
      noteFailure(result.error, result.report);
      return;
    }
    track('code_verified', {}, { leaving: true });
    clearLoginStep();
    const query = {
      ...(next ? { next } : {}),
      ...(asProvider ? { as: 'provider' } : {}),
      ...(reset ? { reset: '1' } : {}),
    };
    window.location.assign(getPathname({ href: { pathname: '/continue', query }, locale }));
  }

  function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    void verify(code);
  }

  function changeNumber() {
    setError(null);
    setChosenStep('phone');
  }

  function backToCode() {
    setError(null);
    setChosenStep('code');
  }

  const message = error ? t(`errors.${error}`, { dialCode }) : null;
  // A help line after a failed code or a limit (AC-34). Not for a mistyped number: the message fixes that.
  const needsHelp = error === 'wrong_or_expired' || (error !== null && error.startsWith('limit_'));
  const errorNote = message ? (
    <div id="login-error" role="alert" className="flex flex-col gap-1 rounded-row bg-error-light px-4 py-3">
      <p className="text-body-s text-error">{message}</p>
      {needsHelp ? (
        <SupportLink
          whatsapp={supportWhatsapp}
          label={t('help')}
          className="text-body-s font-semibold text-error underline underline-offset-4"
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {!signedOut ? (
        <div className="flex flex-1 flex-col gap-4">
          <h1 className="font-display text-title-s text-text-primary">{t('reset.title')}</h1>
          <p className="text-label leading-relaxed font-medium text-text-primary">{t('reset.signedIn')}</p>
          <div className="flex-1" />
          <Button
            id="reset-sign-out"
            type="button"
            size="block"
            disabled={signingOut}
            onClick={() => void signOutForReset()}
          >
            {t('reset.signOut')}
          </Button>
        </div>
      ) : step === 'phone' ? (
        <form onSubmit={onSubmitPhone} noValidate className="flex flex-1 flex-col gap-4">
          <h1 className="font-display text-title-s text-text-primary">
            {reset ? t('reset.title') : t('title')}
          </h1>
          <p className="text-label leading-relaxed font-medium text-text-primary">
            {reset ? t('reset.intro') : t('intro')}
          </p>
          <div className="flex-1" />
          <PhoneField
            id="login-phone"
            label={t('phoneLabel')}
            placeholder={t('phonePlaceholder')}
            dialCode={dialCode}
            error={error !== null}
            errorId="login-error"
            onChange={() => setError(null)}
          />
          {errorNote}
          <Button type="submit" size="block" disabled={busy || !token || !signedOut}>
            {busy ? t('sending') : t('send')}
          </Button>
          {live ? (
            <Button variant="link" size="text" className="self-start" onClick={backToCode}>
              {t('haveCode')}
            </Button>
          ) : null}
        </form>
      ) : (
        <form onSubmit={onSubmitCode} className="flex flex-1 flex-col gap-4">
          <h1 className="font-display text-title-s text-text-primary">{t('codeTitle')}</h1>
          <p className="text-label leading-relaxed font-medium text-text-primary">
            {t.rich('codeSent', {
              number: phone,
              phone: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
            })}{' '}
            <button type="button" className="underline underline-offset-4" onClick={changeNumber}>
              {t('changeNumber')}
            </button>
          </p>
          <CodeField
            label={t('codeLabel')}
            value={code}
            invalid={error === 'wrong_or_expired' || error === 'limit_checks'}
            disabled={busy}
            onChange={(value) => {
              setCode(value);
              setError(null);
            }}
            onComplete={(value) => void verify(value)}
          />
          {errorNote}
          <div className="flex-1" />
          <Button type="submit" size="block" disabled={busy || code.length !== CODE_LENGTH}>
            {busy ? t('verifying') : t('verify')}
          </Button>
          {waitSeconds > 0 ? (
            <p className="text-meta font-normal text-text-primary">
              {t.rich('resendIn', {
                time: formatWait(waitSeconds),
                wait: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
              })}
            </p>
          ) : (
            <Button
              variant="link"
              size="text"
              className="self-start"
              disabled={busy || !token}
              onClick={() => void send(phone)}
            >
              {t('resend')}
            </Button>
          )}
        </form>
      )}
      <Link
        href={{
          pathname: '/login',
          query: { ...(next ? { next } : {}), ...(asProvider ? { as: 'provider' } : {}) },
        }}
        className="inline-flex min-h-11 items-center self-start text-body-s font-semibold text-link underline underline-offset-4"
      >
        {t('havePassword')}
      </Link>
      <BotCheck siteKey={siteKey} nonce={nonce} locale={locale} attempt={attempt} onToken={onToken} />
    </div>
  );
}
