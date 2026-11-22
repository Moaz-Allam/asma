'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { saveApplicationQuestion, saveQuestion } from '@/actions/admin-catalog';
import { FormField } from '@/components/shared/FormField';
import { LocalizedField } from '@/components/shared/LocalizedField';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { parseWhole } from '@/lib/catalog/digits';
import type { CatalogLocale, LocalizedText } from '@/lib/catalog/localized';
import {
  APPLICATION_QUESTION_TYPES,
  CATALOG_LIMITS,
  KEY_PATTERN,
  PRICED_TYPES,
  QUESTION_TYPES,
  SELECT_TYPES,
  TEXT_TYPES,
  type QuestionType,
} from '@/lib/catalog/options';

import { CatalogSheet } from './CatalogSheets';
import { QuestionOptionsEditor, type OptionDraft } from './QuestionOptionsEditor';
import type { CatalogQuestion, CatalogService } from './types';
import { useCatalogAction } from './use-action';

const SELECT_CLASS =
  'h-15.25 w-full rounded-field border-2 border-input bg-surface px-4.5 text-body text-text-primary read-only:bg-surface-secondary disabled:bg-surface-secondary';

/** A whole number, Eastern digits folded; anything else is NaN, which the action's schema refuses. */
function whole(text: string): number {
  return parseWhole(text) ?? Number.NaN;
}

/**
 * Add or edit one question (ui-registry `QuestionBuilder`, spec 0007 AC-3, AC-18). Key, type and scope are
 * asked on create only and shown read only after, because answers already stored use them. Only the types
 * that can price offer "affects the price". The database checks every shape again.
 *
 * Spec 0011-19b AC-2: with `purpose="application"` it builds a question for providers instead: three types (text,
 * a choice, yes or no), no scope, no pricing control, a text limit of 10 to 600, saved by `saveApplicationQuestion`.
 */
export function QuestionBuilder({
  open,
  onOpenChange,
  regionDefault,
  categoryId,
  services,
  question,
  purpose = 'request',
}: {
  purpose?: 'request' | 'application';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  regionDefault: CatalogLocale;
  categoryId: string;
  services: CatalogService[];
  question: CatalogQuestion | null;
}) {
  const t = useTranslations('AdminCatalog');
  const action = useCatalogAction();
  const editing = question !== null;
  const forProviders = purpose === 'application';
  const types: readonly QuestionType[] = forProviders ? APPLICATION_QUESTION_TYPES : QUESTION_TYPES;
  const [key, setKey] = useState(question?.key ?? '');
  const [type, setType] = useState<QuestionType>(question?.type ?? (forProviders ? 'textarea' : 'number'));
  const [serviceId, setServiceId] = useState<string>(question?.serviceId ?? '');
  const [label, setLabel] = useState<LocalizedText>(question?.values ?? {});
  const [help, setHelp] = useState<LocalizedText>(question?.helpValues ?? {});
  const [required, setRequired] = useState(question?.required ?? true);
  const [affectsPricing, setAffectsPricing] = useState(question?.affectsPricing ?? false);
  const [min, setMin] = useState(String(question?.validation?.min ?? 0));
  const [max, setMax] = useState(String(question?.validation?.max ?? 10));
  const [step, setStep] = useState(String(question?.validation?.step ?? 1));
  const [maxLength, setMaxLength] = useState(
    question?.validation?.maxLength === undefined ? '' : String(question.validation.maxLength),
  );
  const [options, setOptions] = useState<OptionDraft[]>(
    question?.options?.map((option) => ({
      uid: option.value,
      value: option.value,
      label: option.values,
      saved: true,
    })) ?? [],
  );

  const canPrice = PRICED_TYPES.includes(type);
  const isSelect = SELECT_TYPES.includes(type);
  const isText = TEXT_TYPES.includes(type);
  const badKey = key !== '' && !KEY_PATTERN.test(key);

  function submit() {
    if (forProviders) {
      const limit = type === 'textarea' && maxLength.trim() !== '' ? { maxLength: whole(maxLength) } : null;
      action.run(
        () =>
          saveApplicationQuestion({
            id: question?.id,
            categoryId,
            key,
            type: type as (typeof APPLICATION_QUESTION_TYPES)[number],
            label,
            helpText: help,
            required,
            options:
              type === 'single_select'
                ? options.map(({ value, label: optionLabel }) => ({ value, label: optionLabel }))
                : null,
            validation: limit,
          }),
        () => onOpenChange(false),
      );
      return;
    }
    const validation =
      type === 'number'
        ? { min: whole(min), max: whole(max), step: whole(step) }
        : isText && maxLength.trim() !== ''
          ? { maxLength: whole(maxLength) }
          : null;
    action.run(
      () =>
        saveQuestion({
          id: question?.id,
          categoryId,
          serviceId: serviceId === '' ? null : serviceId,
          key,
          type,
          label,
          helpText: help,
          required,
          affectsPricing: canPrice && affectsPricing,
          options: isSelect
            ? options.map(({ value, label: optionLabel }) => ({ value, label: optionLabel }))
            : null,
          validation,
        }),
      () => onOpenChange(false),
    );
  }

  return (
    <CatalogSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        forProviders
          ? t(editing ? 'editProviderQuestion' : 'newProviderQuestion')
          : t(editing ? 'editQuestion' : 'newQuestion')
      }
      description={forProviders ? t('providerQuestionSheetNote') : t('questionSheetNote')}
      busy={action.busy}
      error={action.error}
      onSubmit={submit}
      wide
    >
      <FormField
        id="question-key"
        label={t('fieldKey')}
        note={t(editing ? 'keyFixed' : 'keyRule')}
        error={badKey ? t('keyInvalid') : null}
      >
        <Input
          id="question-key"
          dir="ltr"
          className="font-mono"
          value={key}
          readOnly={editing}
          maxLength={CATALOG_LIMITS.key}
          aria-invalid={badKey || undefined}
          aria-describedby={badKey ? 'question-key-error' : undefined}
          onChange={(event) => setKey(event.target.value)}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="question-type" label={t('fieldType')}>
          <select
            id="question-type"
            className={SELECT_CLASS}
            value={type}
            disabled={editing}
            onChange={(event) => setType(event.target.value as QuestionType)}
          >
            {types.map((value) => (
              <option key={value} value={value}>
                {t(`type.${value}`)}
              </option>
            ))}
          </select>
        </FormField>
        {forProviders ? null : (
          <FormField id="question-scope" label={t('fieldScope')}>
            <select
              id="question-scope"
              className={SELECT_CLASS}
              value={serviceId}
              disabled={editing}
              onChange={(event) => setServiceId(event.target.value)}
            >
              <option value="">{t('scopeAll')}</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </FormField>
        )}
      </div>
      <LocalizedField
        id="question-label"
        label={t('fieldLabel')}
        value={label}
        onChange={setLabel}
        regionDefault={regionDefault}
        maxLength={CATALOG_LIMITS.name}
      />
      <LocalizedField
        id="question-help"
        optional
        label={t('fieldHelp')}
        value={help}
        onChange={setHelp}
        regionDefault={regionDefault}
        maxLength={CATALOG_LIMITS.helpText}
      />
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-body-s font-bold text-text-primary">{t('fieldRequired')}</span>
        <Switch checked={required} onCheckedChange={setRequired} aria-label={t('fieldRequired')} />
      </label>
      {forProviders ? null : canPrice ? (
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-body-s font-bold text-text-primary">{t('fieldAffectsPrice')}</span>
            <Switch
              checked={affectsPricing}
              onCheckedChange={setAffectsPricing}
              aria-label={t('fieldAffectsPrice')}
            />
          </label>
          {affectsPricing && !required && type !== 'multi_select' ? (
            <p className="text-meta text-text-secondary">{t('pricedMustBeRequired')}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-meta text-text-secondary">{t('neverPrices')}</p>
      )}
      {type === 'number' ? (
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['min', min, setMin],
              ['max', max, setMax],
              ['step', step, setStep],
            ] as const
          ).map(([field, value, set]) => (
            <FormField key={field} id={`question-${field}`} label={t(`field_${field}`)}>
              <Input
                id={`question-${field}`}
                inputMode="numeric"
                dir="ltr"
                value={value}
                onChange={(event) => set(event.target.value)}
              />
            </FormField>
          ))}
          <p className="col-span-3 text-meta text-text-secondary">
            {t('numberRule', { limit: CATALOG_LIMITS.numberMax })}
          </p>
        </div>
      ) : null}
      {isText ? (
        <FormField
          id="question-max-length"
          label={t('fieldMaxLength')}
          note={
            forProviders
              ? t('answerLengthRule', { min: CATALOG_LIMITS.answerMin, limit: CATALOG_LIMITS.answerMax })
              : t('maxLengthRule', {
                  limit: type === 'text' ? CATALOG_LIMITS.textMax : CATALOG_LIMITS.textareaMax,
                  fallback: type === 'text' ? CATALOG_LIMITS.textDefault : CATALOG_LIMITS.textareaDefault,
                })
          }
        >
          <Input
            id="question-max-length"
            inputMode="numeric"
            dir="ltr"
            value={maxLength}
            onChange={(event) => setMaxLength(event.target.value)}
          />
        </FormField>
      ) : null}
      {isSelect ? (
        <QuestionOptionsEditor
          options={options}
          onChange={setOptions}
          regionDefault={regionDefault}
          inUse={question?.inUseValues ?? []}
        />
      ) : null}
    </CatalogSheet>
  );
}
