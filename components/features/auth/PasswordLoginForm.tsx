'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type FormEvent } from 'react';

import { BotCheck } from '@/components/features/auth/BotCheck';
import { PasswordField } from '@/components/features/auth/PasswordField';
import { PhoneField } from '@/components/features/auth/PhoneField';
import { SupportLink } from '@/components/shared/SupportLink';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import type { AnalyticsEvents } from '@/lib/analytics/events';
import type { PasswordSignInError } from '@/lib/auth/auth-errors';
import { signInWithPassword } from '@/lib/auth/password';
import { getPathname, Link } from '@/lib/i18n/navigation';
import { reportClientError } from '@/lib/observability/client';
import { normalizeForRegions, type PhoneRejection } from '@/lib/region/phone';

/**
 * Sign in with phone and password (spec 0012 AC-1, AC-2, AC-3). The browser calls Supabase Auth through `lib/auth`,
 * never a Server Action of ours (D98), so the password never reaches our server. An unknown phone, a wrong password
 * and an account with no password yet show one message. The code route stays one link away.
 */

type FormError = PhoneRejection | PasswordSignInError | 'password_empty' | null;

const FAILURE_REASON: Readonly<
  Record<PasswordSignInError, AnalyticsEvents['password_sign_in_failed']['reason']>
> = {
  bad_credentials: 'credentials',
  limit_ip: 'limit',
  bot_check_failed: 'bot_check',
  network: 'network',
};

type Props = {
  dialCodes: readonly string[];
  siteKey: string | undefined;
  nonce: string | undefined;
  next: string | null;
  asProvider: boolean;
  supportWhatsapp: string | null | undefined;
};

export function PasswordLoginForm({ dialCodes, siteKey, nonce, next, asProvider, supportWhatsapp }: Props) {
  const t = useTranslations('Login');
  const locale = useLocale();
  const dialCode = dialCodes[0] ?? '';

  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FormError>(null);
  const onToken = useCallback((value: string | null) => setToken(value), []);

  const carried = { ...(next ? { next } : {}), ...(asProvider ? { as: 'provider' } : {}) };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || busy) return;
    const data = new FormData(event.currentTarget);
    const typed = data.get('phone');
    const password = data.get('password');
    const normalized = normalizeForRegions(typeof typed === 'string' ? typed : '', dialCodes);
    if (!normalized.ok) {
      setError(normalized.reason);
      track('phone_rejected', { reason: normalized.reason });
      return;
    }
    if (typeof password !== 'string' || password.length === 0) {
      setError('password_empty');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signInWithPassword(normalized.phone, password, token);
    // A token works once, whatever the answer was.
    setAttempt((count) => count + 1);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      track('password_sign_in_failed', { reason: FAILURE_REASON[result.error] });
      // By stable code only: nothing Auth said reaches Sentry.
      if (result.report) reportClientError(new Error(`auth_password_${result.error}`));
      return;
    }
    track('password_signed_in', {}, { leaving: true });
    window.location.assign(getPathname({ href: { pathname: '/continue', query: carried }, locale }));
  }

  const message = error ? t(`errors.${error}`, { dialCode }) : null;
  const needsHelp = error === 'limit_ip';

  return (
    <div className="flex flex-1 flex-col gap-4">
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-1 flex-col gap-4">
        <h1 className="font-display text-title-s text-text-primary">{t('password.title')}</h1>
        <p className="text-label leading-relaxed font-medium text-text-primary">{t('password.intro')}</p>
        <div className="flex-1" />
        <PhoneField
          id="login-phone"
          label={t('phoneLabel')}
          placeholder={t('phonePlaceholder')}
          dialCode={dialCode}
          autoComplete="username tel"
          error={error !== null && error !== 'password_empty'}
          errorId="login-error"
          onChange={() => setError(null)}
        />
        <PasswordField
          id="login-password"
          name="password"
          label={t('password.label')}
          autoComplete="current-password"
          showLabel={t('password.show')}
          hideLabel={t('password.hide')}
          error={error !== null}
          describedBy="login-error"
          onChange={() => setError(null)}
        />
        <Link
          href={{ pathname: '/login', query: { mode: 'code', reset: '1', ...carried } }}
          className="self-start text-body-s font-semibold text-link underline underline-offset-4"
        >
          {t('password.forgot')}
        </Link>
        {message ? (
          <div
            id="login-error"
            role="alert"
            className="flex flex-col gap-1 rounded-row bg-error-light px-4 py-3"
          >
            <p className="text-body-s text-error">{message}</p>
            {needsHelp ? (
              <SupportLink
                whatsapp={supportWhatsapp}
                label={t('help')}
                className="text-body-s font-semibold text-error underline underline-offset-4"
              />
            ) : null}
          </div>
        ) : null}
        <Button type="submit" size="block" disabled={busy || !token}>
          {busy ? t('password.submitting') : t('password.submit')}
        </Button>
        <Link
          href={{ pathname: '/login', query: { mode: 'code', ...carried } }}
          className="self-start text-body-s font-semibold text-link underline underline-offset-4"
        >
          {t('password.newHere')}
        </Link>
      </form>
      <BotCheck siteKey={siteKey} nonce={nonce} locale={locale} attempt={attempt} onToken={onToken} />
    </div>
  );
}
