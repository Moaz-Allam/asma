'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type FormEvent } from 'react';

import { BotCheck } from '@/components/features/auth/BotCheck';
import { PasswordField } from '@/components/features/auth/PasswordField';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import type { PasswordSignInError, SetPasswordError } from '@/lib/auth/auth-errors';
import {
  changePassword,
  passwordProblems,
  signOutOtherDevices,
  type PasswordProblem,
} from '@/lib/auth/password';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { reportClientError } from '@/lib/observability/client';

/**
 * Change the password from the account page (spec 0012 AC-7): the current one first, through a sign in with the
 * account's own phone (read on the server, never typed) and one bot check token, then the new one, then every other
 * session ends. A wrong current password shows `bad_credentials`. A slip guard, not an attacker guard.
 */

type Props = {
  /** `profiles.phone`, E.164. */
  phone: string;
  siteKey: string | undefined;
  nonce: string | undefined;
};

export function ChangePasswordForm({ phone, siteKey, nonce }: Props) {
  const t = useTranslations('Account.password');
  const locale = useLocale();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<PasswordProblem[]>([]);
  const [error, setError] = useState<PasswordSignInError | SetPasswordError | null>(null);
  const [done, setDone] = useState<'changed' | 'others_left' | null>(null);
  const onToken = useCallback((value: string | null) => setToken(value), []);
  // Disabled until hydration on purpose, not only until the token: a native GET would put the passwords in the URL.
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = String(data.get('current') ?? '');
    const password = String(data.get('password') ?? '');
    const repeat = String(data.get('repeat') ?? '');
    const found = passwordProblems(password, phone, repeat);
    setProblems(found);
    setError(null);
    setDone(null);
    if (found.length > 0) return;
    if (current.length === 0) {
      setError('bad_credentials');
      return;
    }
    setBusy(true);
    const result = await changePassword(phone, current, password, token);
    // The token is used once, by the sign in.
    setAttempt((count) => count + 1);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      if (result.report) reportClientError(new Error(`auth_change_password_${result.error}`));
      return;
    }
    track('password_set', { reason: 'change' });
    const othersOut = await signOutOtherDevices();
    if (!othersOut) reportClientError(new Error('auth_sign_out_others_failed'));
    form.reset();
    setBusy(false);
    setDone(othersOut ? 'changed' : 'others_left');
    // The server page reads "last changed" again.
    router.refresh();
  }

  const invalid = problems.length > 0 || error !== null;
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <PasswordField
        id="current-password"
        name="current"
        label={t('currentLabel')}
        autoComplete="current-password"
        showLabel={t('show')}
        hideLabel={t('hide')}
        error={error === 'bad_credentials'}
        describedBy="change-password-error"
      />
      <Link
        href={{ pathname: '/login', query: { mode: 'code', reset: '1', next: '/account' } }}
        className="self-start text-body-s font-semibold text-link underline underline-offset-4"
      >
        {t('forgot')}
      </Link>
      <PasswordField
        id="change-new-password"
        name="password"
        label={t('newLabel')}
        autoComplete="new-password"
        showLabel={t('show')}
        hideLabel={t('hide')}
        hint={t('rules')}
        error={problems.length > 0}
        describedBy="change-password-error"
      />
      <PasswordField
        id="change-repeat-password"
        name="repeat"
        label={t('repeatLabel')}
        autoComplete="new-password"
        showLabel={t('show')}
        hideLabel={t('hide')}
        error={problems.includes('mismatch')}
        describedBy="change-password-error"
      />
      {invalid ? (
        <div
          id="change-password-error"
          role="alert"
          className="flex flex-col gap-1 rounded-row bg-error-light px-4 py-3"
        >
          {problems.map((problem) => (
            <p key={problem} className="text-body-s text-error">
              {t(`problems.${problem}`)}
            </p>
          ))}
          {error ? <p className="text-body-s text-error">{t(`errors.${error}`)}</p> : null}
          {error === 'reauth_needed' ? (
            <Link
              href={{ pathname: '/login', query: { mode: 'code', reset: '1', next: '/account' } }}
              className="text-body-s font-semibold text-error underline underline-offset-4"
            >
              {t('codeAgain')}
            </Link>
          ) : null}
        </div>
      ) : null}
      {done ? (
        <p
          role="status"
          className={
            done === 'changed'
              ? 'rounded-row bg-success-light px-4 py-3 text-body-s text-text-primary'
              : 'rounded-row bg-warning-light px-4 py-3 text-body-s text-text-primary'
          }
        >
          {done === 'changed' ? t('changed') : t('othersLeft')}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={busy || !token || !hydrated}>
        {busy ? t('saving') : t('change')}
      </Button>
      <BotCheck siteKey={siteKey} nonce={nonce} locale={locale} attempt={attempt} onToken={onToken} />
    </form>
  );
}
