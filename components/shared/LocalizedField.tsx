'use client';

import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CatalogLocale, LocalizedText } from '@/lib/catalog/localized';
import { CATALOG_LOCALES } from '@/lib/catalog/localized';

/**
 * One text in three languages (ui-registry `LocalizedField`, spec 0007 AC-2): a field per locale, each in
 * its own direction, the region's default first and marked required, the others optional. What admin types
 * is shown as typed and saved escaped by React, never as markup.
 */
export function LocalizedField({
  id,
  label,
  value,
  onChange,
  regionDefault,
  maxLength,
  error,
  optional = false,
}: {
  id: string;
  label: string;
  value: LocalizedText;
  onChange: (value: LocalizedText) => void;
  regionDefault: CatalogLocale;
  maxLength: number;
  error?: string | null;
  /** The whole text may stay empty (a note, a help text): no locale is required then. */
  optional?: boolean;
}) {
  const t = useTranslations('AdminCatalog');
  const order = [regionDefault, ...CATALOG_LOCALES.filter((locale) => locale !== regionDefault)];

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1 text-body-s font-bold text-text-primary">{label}</legend>
      {order.map((locale) => {
        const fieldId = `${id}-${locale}`;
        const required = !optional && locale === regionDefault;
        return (
          <div key={locale} className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId} className="text-meta text-text-secondary">
              {t(`locale.${locale}`)}
              {required ? ` · ${t('required')}` : ` · ${t('optional')}`}
            </Label>
            <Input
              id={fieldId}
              lang={locale}
              dir={locale === 'ar' ? 'rtl' : 'ltr'}
              value={value[locale] ?? ''}
              maxLength={maxLength}
              required={required}
              aria-invalid={required && error ? true : undefined}
              onChange={(event) => onChange({ ...value, [locale]: event.target.value })}
            />
          </div>
        );
      })}
      {error ? (
        <p id={`${id}-error`} className="text-meta text-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
