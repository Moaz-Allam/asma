'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LocalizedField } from '@/components/shared/LocalizedField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CatalogLocale, LocalizedText } from '@/lib/catalog/localized';
import { CATALOG_LIMITS, OPTION_VALUE_PATTERN } from '@/lib/catalog/options';

export type OptionDraft = { value: string; label: LocalizedText; saved: boolean };

/**
 * The options of a select question (ui-registry `QuestionOptionsEditor`, spec 0007 AC-18). A value is typed
 * once, when the option is added, and is what an answer stores, so a saved option's value is read only. An
 * option a published formula matches cannot be removed: the database refuses it (`question_in_use`).
 */
export function QuestionOptionsEditor({
  options,
  onChange,
  regionDefault,
}: {
  options: OptionDraft[];
  onChange: (options: OptionDraft[]) => void;
  regionDefault: CatalogLocale;
}) {
  const t = useTranslations('AdminCatalog');

  function patch(index: number, next: Partial<OptionDraft>) {
    onChange(options.map((option, i) => (i === index ? { ...option, ...next } : option)));
  }

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-body-s font-bold text-text-primary">{t('fieldOptions')}</legend>
      {options.map((option, index) => {
        const id = `option-${index}`;
        const badValue = option.value !== '' && !OPTION_VALUE_PATTERN.test(option.value);
        return (
          <div key={id} className="flex flex-col gap-3 rounded-row border-2 border-border p-4">
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={`${id}-value`} className="text-meta text-text-secondary">
                  {t('optionValue')}
                </Label>
                <Input
                  id={`${id}-value`}
                  dir="ltr"
                  className="font-mono"
                  value={option.value}
                  readOnly={option.saved}
                  maxLength={CATALOG_LIMITS.optionValue}
                  aria-invalid={badValue || undefined}
                  aria-describedby={`${id}-value-note`}
                  onChange={(event) => patch(index, { value: event.target.value })}
                />
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="min-h-11"
                onClick={() => onChange(options.filter((_, i) => i !== index))}
                aria-label={t('removeOption', { value: option.value || String(index + 1) })}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
            <p
              id={`${id}-value-note`}
              className={badValue ? 'text-meta text-error' : 'text-meta text-text-secondary'}
            >
              {t(option.saved ? 'optionValueFixed' : 'optionValueRule')}
            </p>
            <LocalizedField
              id={`${id}-label`}
              label={t('optionLabel')}
              value={option.label}
              onChange={(label) => patch(index, { label })}
              regionDefault={regionDefault}
              maxLength={CATALOG_LIMITS.name}
            />
          </div>
        );
      })}
      {options.length < CATALOG_LIMITS.options ? (
        <Button
          variant="secondary"
          onClick={() => onChange([...options, { value: '', label: {}, saved: false }])}
          className="self-start"
        >
          {t('addOption')}
        </Button>
      ) : null}
    </fieldset>
  );
}
