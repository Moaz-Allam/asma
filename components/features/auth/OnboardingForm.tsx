'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';

import { completeOnboarding } from '@/actions/onboarding';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { track } from '@/lib/analytics/client';
import { useHydrated } from '@/lib/browser/use-hydrated';
import { getPathname, Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

type ChosenRole = 'customer' | 'provider';

const POINTS = [1, 2, 3] as const;

/**
 * Role, name and the agreement, once (`s11`, spec 0005 AC-7). Everything else comes from the verified
 * account on the server. The client sends a choice, never a region, a phone or a terms version.
 */
export function OnboardingForm({ preselect }: { preselect: ChosenRole }) {
  const t = useTranslations('Onboarding');
  const locale = useLocale();
  const [role, setRole] = useState<ChosenRole>(preselect);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = new FormData(event.currentTarget).get('fullName');
    const fullName = typeof typed === 'string' ? typed : '';
    if (fullName.trim().length < 2) return setError('name');
    if (!accepted) return setError('agreement');
    setError(null);
    startTransition(async () => {
      const result = await completeOnboarding({ role, fullName, accepted: true });
      if (result.success) {
        track('onboarding_completed', { role }, { leaving: true });
        window.location.assign(getPathname({ href: result.data.destination, locale }));
      } else if (result.error === 'unauthorized') {
        window.location.assign(getPathname({ href: '/login', locale }));
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <fieldset className="grid gap-3.5 lg:grid-cols-2">
        <legend className="sr-only">{t('roleLegend')}</legend>
        {(['customer', 'provider'] as const).map((option) => (
          <label
            key={option}
            className={cn(
              'flex cursor-pointer flex-col gap-3 rounded-panel border-2 px-6.5 py-6 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
              role === option ? 'border-accent bg-accent-light' : 'border-border bg-surface',
            )}
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="role"
                value={option}
                checked={role === option}
                onChange={() => setRole(option)}
                className="size-5 accent-accent"
              />
              <span className="font-display text-section text-text-primary">{t(`${option}Title`)}</span>
            </span>
            <span className="text-label text-text-primary">{t(`${option}Lead`)}</span>
            <span className="flex flex-col gap-1.5">
              {POINTS.map((point) => (
                <span key={point} className="text-body-s text-text-secondary">
                  {t(`${option}Point${point}`)}
                </span>
              ))}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex max-w-md flex-col gap-2">
        <Label htmlFor="full-name">{t('nameLabel')}</Label>
        <Input
          id="full-name"
          name="fullName"
          autoComplete="name"
          maxLength={100}
          aria-invalid={error === 'name'}
        />
      </div>

      <div className="flex items-start gap-3">
        <Checkbox
          id="agreement"
          checked={accepted}
          aria-invalid={error === 'agreement'}
          onCheckedChange={(value) => setAccepted(value === true)}
        />
        <Label htmlFor="agreement" className="font-medium">
          {t.rich('agreement', {
            terms: (chunks) => (
              <Link href="/terms" target="_blank" className="text-link underline underline-offset-4">
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link href="/privacy" target="_blank" className="text-link underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </Label>
      </div>

      {error ? (
        <p role="alert" className="rounded-row bg-error-light px-4 py-3 text-body-s text-error">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={isPending || !hydrated}>
          {isPending ? t('saving') : t(role === 'customer' ? 'continueCustomer' : 'continueProvider')}
        </Button>
        <p className="text-body-s text-text-secondary">
          {t(role === 'customer' ? 'nextCustomer' : 'nextProvider')}
        </p>
      </div>
    </form>
  );
}
