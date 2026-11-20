'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { PasswordField } from '@/components/features/auth/PasswordField';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import type { SetPasswordError } from '@/lib/auth/auth-errors';
import {
  passwordProblems,
  setPassword,
  signOutOtherDevices,
  type PasswordProblem,
} from '@/lib/auth/password';
import { getPathname, Link } from '@/lib/i18n/navigation';
import { reportClientError } from '@/lib/observability/client';

/**
 * A first password, or a reset one (spec 0012 AC-5, AC-6), on the session a code sign in created. The browser calls
 * Supabase Auth through `lib/auth`; the password never reaches our server. Every other session ends after the save.
 * `reason` in the URL only changes the words and the event: Auth decides what is allowed.
 */

type Props = {
  /** The account's own phone (E.164), from `profiles.phone`, for the weak check only. */
  phone: string | null;
  reason: 'first' | 'reset';
  /** Where to go after, without the locale, already checked on the server. */
  next: string;
};

export function SetPasswordForm({ phone, reason, next }: Props) {
  const t = useTranslations('Account.password');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<PasswordProblem[]>([]);
  const [error, setError] = useState<SetPasswordError | null>(null);
  const [othersLeft, setOthersLeft] = useState(false);

  const destination = getPathname({ href: next, locale });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const repeat = String(data.get('repeat') ?? '');
    const found = passwordProblems(password, phone, repeat);
    setProblems(found);
    setError(null);
    if (found.length > 0) return;
    setBusy(true);
    const result = await setPassword(password);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      if (result.report) reportClientError(new Error(`auth_set_password_${result.error}`));
      return;
    }
    track('password_set', { reason });
    if (!(await signOutOtherDevices())) {
      reportClientError(new Error('auth_sign_out_others_failed'));
      setBusy(false);
      setOthersLeft(true);
      return;
    }
    window.location.assign(destination);
  }

  if (othersLeft) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-row bg-warning-light px-4 py-3 text-body-s text-text-primary">
          {t('othersLeft')}
        </p>
        <Button size="block" onClick={() => window.location.assign(destination)}>
          {t('continue')}
        </Button>
      </div>
    );
  }

  const invalid = problems.length > 0 || error !== null;
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <p id="password-rules" className="text-body-s text-text-secondary">
        {t('rules')}
      </p>
      <PasswordField
        id="new-password"
        name="password"
        label={t('newLabel')}
        autoComplete="new-password"
        showLabel={t('show')}
        hideLabel={t('hide')}
        error={invalid}
        describedBy="password-error"
        onChange={() => setError(null)}
      />
      <PasswordField
        id="repeat-password"
        name="repeat"
        label={t('repeatLabel')}
        autoComplete="new-password"
        showLabel={t('show')}
        hideLabel={t('hide')}
        error={problems.includes('mismatch')}
        describedBy="password-error"
      />
      {invalid ? (
        <div
          id="password-error"
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
              href={{ pathname: '/login', query: { mode: 'code', reset: '1', next } }}
              className="text-body-s font-semibold text-error underline underline-offset-4"
            >
              {t('codeAgain')}
            </Link>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" size="block" disabled={busy}>
        {busy ? t('saving') : reason === 'reset' ? t('saveReset') : t('save')}
      </Button>
    </form>
  );
}
