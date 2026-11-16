'use client';

import { useTranslations } from 'next-intl';

import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { FormField } from '@/components/shared/FormField';
import { ToggleChips } from '@/components/shared/ToggleChips';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { FormQuestion } from '@/lib/requests/view';

/**
 * The questions of a service, rendered by type (ui-registry `DynamicQuestionForm`, spec 0008 AC-21): a number
 * as chips when it has at most 8 values, else a number field; a single choice and a yes or no as
 * `ChoiceChips`; several choices as `ToggleChips`; text with its counter; a date and a time as native inputs.
 * Labels arrive in the page's locale. Hints are plain TypeScript; the server is the check (D106).
 */

const MAX_CHIPS = 8;
const TEXT_LIMIT = { text: 200, textarea: 500 } as const;

function numberValues(q: FormQuestion): number[] | null {
  const min = q.validation?.min ?? 0;
  const max = q.validation?.max ?? 0;
  const step = q.validation?.step ?? 1;
  if (step < 1 || (max - min) / step + 1 > MAX_CHIPS) return null;
  const out: number[] = [];
  for (let n = min; n <= max; n += step) out.push(n);
  return out;
}

export function DynamicQuestionForm({
  idPrefix,
  questions,
  answers,
  errors,
  onChange,
}: {
  idPrefix: string;
  questions: readonly FormQuestion[];
  answers: Record<string, unknown>;
  /** Answer error codes by question key, from the server. */
  errors: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
}) {
  const t = useTranslations('Requests');
  return (
    <div className="flex flex-col gap-6">
      {questions.map((q) => {
        const id = `${idPrefix}-${q.key}`;
        const code = errors[q.key];
        const error = code ? t(`errors.${code}` as 'errors.answer_invalid') : null;
        const legend = q.label;
        const value = answers[q.key];
        let control: React.ReactNode;

        if (q.type === 'number') {
          const values = numberValues(q);
          if (values) {
            control = (
              <ChoiceChips
                name={id}
                legend={legend}
                options={values.map((n) => ({ value: String(n), label: String(n) }))}
                value={typeof value === 'number' ? String(value) : null}
                onChange={(v) => onChange(q.key, Number(v))}
              />
            );
          } else {
            control = (
              <FormField
                id={id}
                label={legend}
                error={error}
                note={t('answers.range', { min: q.validation?.min ?? 0, max: q.validation?.max ?? 0 })}
              >
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={q.validation?.min}
                  max={q.validation?.max}
                  step={q.validation?.step}
                  value={typeof value === 'number' ? value : ''}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(e) => onChange(q.key, e.target.value === '' ? null : Number(e.target.value))}
                />
              </FormField>
            );
          }
        } else if (q.type === 'single_select') {
          control = (
            <ChoiceChips
              name={id}
              legend={legend}
              options={q.options ?? []}
              value={typeof value === 'string' ? value : null}
              onChange={(v) => onChange(q.key, v)}
            />
          );
        } else if (q.type === 'boolean') {
          control = (
            <ChoiceChips
              name={id}
              legend={legend}
              options={[
                { value: 'true', label: t('answers.yes') },
                { value: 'false', label: t('answers.no') },
              ]}
              value={typeof value === 'boolean' ? String(value) : null}
              onChange={(v) => onChange(q.key, v === 'true')}
            />
          );
        } else if (q.type === 'multi_select') {
          control = (
            <ToggleChips
              name={id}
              legend={legend}
              options={q.options ?? []}
              values={Array.isArray(value) ? (value as string[]) : []}
              onChange={(v) => onChange(q.key, v)}
              invalid={Boolean(error)}
            />
          );
        } else if (q.type === 'text' || q.type === 'textarea') {
          const max = q.validation?.maxLength ?? TEXT_LIMIT[q.type];
          const text = typeof value === 'string' ? value : '';
          const Control = q.type === 'text' ? Input : Textarea;
          control = (
            <FormField
              id={id}
              label={legend}
              error={error}
              note={t('answers.count', { count: [...text].length, max })}
            >
              <Control
                id={id}
                value={text}
                maxLength={max}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  onChange(q.key, e.target.value)
                }
              />
            </FormField>
          );
        } else {
          control = (
            <FormField id={id} label={legend} error={error}>
              <Input
                id={id}
                type={q.type}
                value={typeof value === 'string' ? value : ''}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => onChange(q.key, e.target.value === '' ? null : e.target.value)}
              />
            </FormField>
          );
        }

        const chips =
          q.type === 'single_select' ||
          q.type === 'boolean' ||
          q.type === 'multi_select' ||
          (q.type === 'number' && numberValues(q) !== null);
        return (
          <div key={q.key} className="flex flex-col gap-1.5" data-question={q.key}>
            {control}
            {q.help ? <p className="text-meta text-text-secondary">{q.help}</p> : null}
            {chips && error ? (
              <p id={`${id}-error`} className="text-meta text-error">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
