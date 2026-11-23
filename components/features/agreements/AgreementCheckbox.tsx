'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Link } from '@/lib/i18n/navigation';

/**
 * The required service agreement tick (ui-registry `AgreementCheckbox`, spec 0011-20 AC-2 to AC-4, AC-13). Above every
 * fee payment and on the carried re-pick: "I accept the service agreement" with a link to exactly the version it
 * accepts, and the terms in the same label. The caller keeps the state and disables its button until it is ticked;
 * `showError` announces why the button waits. The version is the database's (`agreement_template` or the customer's
 * accepted one); Postgres checks it again and refuses `agreement_required`.
 */
export function AgreementCheckbox({
  version,
  checked,
  onCheckedChange,
  showError = false,
}: {
  version: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  showError?: boolean;
}) {
  const t = useTranslations('Agreement');
  const id = useId();
  const errorId = `${id}-error`;
  const link = 'text-link underline underline-offset-4';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          required
          aria-required="true"
          aria-invalid={showError && !checked}
          aria-describedby={showError && !checked ? errorId : undefined}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        <Label htmlFor={id} className="text-body-s font-medium text-text-primary">
          {t.rich('checkbox', {
            agreement: (chunks) => (
              <Link
                href={`/agreement/${encodeURIComponent(version)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={link}
              >
                {chunks}
              </Link>
            ),
            terms: (chunks) => (
              <Link href="/terms" target="_blank" rel="noopener noreferrer" className={link}>
                {chunks}
              </Link>
            ),
          })}
        </Label>
      </div>
      {showError && !checked ? (
        <p id={errorId} role="alert" className="text-body-s text-error-foreground">
          {t('required')}
        </p>
      ) : null}
    </div>
  );
}
