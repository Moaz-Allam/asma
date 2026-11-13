'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ToggleChips } from '@/components/shared/ToggleChips';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CATALOG_LIMITS,
  effectsFor,
  matchesFor,
  type EffectType,
  type MatchType,
} from '@/lib/catalog/options';

import type { EditorModifier, PricingQuestion } from './types';

const SELECT_CLASS =
  'h-11 rounded-field-sm border-2 border-input bg-surface px-3.5 text-body-s text-text-primary';
const NONE = '__none__';

/** A whole number as typed, or the text itself so the database refuses it: never a guessed number. */
function wholeOrText(text: string): unknown {
  return /^-?[0-9]{1,6}$/.test(text.trim()) ? Number(text.trim()) : text;
}

function defaultValue(match: MatchType, question: PricingQuestion | null): unknown {
  if (match === 'always' || match === 'is_true') return null;
  if (match === 'range') return { min: question?.validation?.min ?? 0, max: question?.validation?.max ?? 0 };
  if (match === 'in') return question?.options?.slice(0, 1).map((o) => o.value) ?? [];
  if (question?.type === 'number') return question.validation?.min ?? 0;
  return question?.options?.[0]?.value ?? '';
}

/** A fresh modifier for a question, with the first match and effect the table allows. */
export function newModifier(question: PricingQuestion | null): EditorModifier {
  const matchType = matchesFor(question?.type ?? null)[0] ?? 'always';
  const effectType = effectsFor(question?.type ?? null, matchType)[0] ?? 'FIXED';
  return {
    uid: crypto.randomUUID(),
    questionKey: question?.key ?? null,
    matchType,
    matchValue: defaultValue(matchType, question),
    effectType,
    amount: effectType === 'MULTIPLIER' ? null : '',
    factor: effectType === 'MULTIPLIER' ? '' : null,
  };
}

/**
 * The formula as structured rows (ui-registry `PricingRulesEditor`, `app-06`, spec 0007 AC-20, rule 8): one
 * card per modifier, in order. A card offers only the match types and effects the match table allows for its
 * question, so a draft can be wrong only in its values, and the database names the card that is. No card
 * holds an expression.
 */
export function PricingRulesEditor({
  modifiers,
  onChange,
  questions,
  errors,
  currency,
}: {
  modifiers: EditorModifier[];
  onChange: (modifiers: EditorModifier[]) => void;
  questions: PricingQuestion[];
  errors: Map<number, string>;
  currency: string;
}) {
  const t = useTranslations('AdminPricing');
  const [adding, setAdding] = useState<string>(questions[0]?.key ?? NONE);
  const byKey = new Map(questions.map((q) => [q.key, q]));

  function patch(index: number, next: Partial<EditorModifier>) {
    onChange(modifiers.map((m, i) => (i === index ? { ...m, ...next } : m)));
  }
  function move(index: number, to: number) {
    const next = [...modifiers];
    const [row] = next.splice(index, 1);
    if (row) next.splice(to, 0, row);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {modifiers.map((m, index) => {
        const question = m.questionKey ? (byKey.get(m.questionKey) ?? null) : null;
        const label = m.questionKey ? (question?.label ?? m.questionKey) : t('noQuestion');
        const matches = matchesFor(question?.type ?? null);
        const effects = effectsFor(question?.type ?? null, m.matchType);
        const error = errors.get(index + 1);
        const id = `modifier-${m.uid}`;
        return (
          <article
            key={m.uid}
            aria-labelledby={`${id}-title`}
            className={`flex flex-col gap-3 rounded-row border-2 px-4 py-3.5 ${error ? 'border-error' : 'border-border'}`}
          >
            <div className="flex items-center gap-3">
              <span className="w-5.5 font-display text-body-s text-text-secondary">{index + 1}</span>
              <h3
                id={`${id}-title`}
                className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-label text-text-primary"
              >
                {label}
                {m.questionKey ? (
                  <span dir="ltr" className="font-mono text-meta text-text-secondary">
                    {m.questionKey}
                  </span>
                ) : null}
              </h3>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full bg-surface-secondary text-text-primary disabled:opacity-40"
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                aria-label={t('moveUp', { n: index + 1 })}
              >
                <ChevronUp className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full bg-surface-secondary text-text-primary disabled:opacity-40"
                disabled={index === modifiers.length - 1}
                onClick={() => move(index, index + 1)}
                aria-label={t('moveDown', { n: index + 1 })}
              >
                <ChevronDown className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full bg-surface text-error"
                onClick={() => onChange(modifiers.filter((_, i) => i !== index))}
                aria-label={t('remove', { n: index + 1 })}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-3 ps-8.5">
              <div className="flex flex-wrap items-end gap-2.5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-match`} className="text-meta text-text-secondary">
                    {t('condition')}
                  </Label>
                  <select
                    id={`${id}-match`}
                    className={SELECT_CLASS}
                    value={m.matchType}
                    onChange={(event) => {
                      const matchType = event.target.value as MatchType;
                      const allowed = effectsFor(question?.type ?? null, matchType);
                      const effectType = allowed.includes(m.effectType)
                        ? m.effectType
                        : (allowed[0] ?? 'FIXED');
                      patch(index, {
                        matchType,
                        matchValue: defaultValue(matchType, question),
                        effectType,
                        amount: effectType === 'MULTIPLIER' ? null : (m.amount ?? ''),
                        factor: effectType === 'MULTIPLIER' ? (m.factor ?? '') : null,
                      });
                    }}
                  >
                    {matches.map((match) => (
                      <option key={match} value={match}>
                        {t(`match.${match}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <MatchValue
                  id={id}
                  modifier={m}
                  question={question}
                  onChange={(matchValue) => patch(index, { matchValue })}
                />
              </div>

              <ChoiceChips<EffectType>
                name={`${id}-effect`}
                legend={t('effect')}
                options={effects.map((effect) => ({ value: effect, label: t(`effectType.${effect}`) }))}
                value={m.effectType}
                onChange={(effectType) =>
                  patch(index, {
                    effectType,
                    amount: effectType === 'MULTIPLIER' ? null : (m.amount ?? ''),
                    factor: effectType === 'MULTIPLIER' ? (m.factor ?? '') : null,
                  })
                }
              />

              <div className="flex max-w-60 flex-col gap-1.5">
                <Label htmlFor={`${id}-value`} className="text-meta text-text-secondary">
                  {m.effectType === 'MULTIPLIER' ? t('factor') : t('amount', { currency })}
                </Label>
                <Input
                  id={`${id}-value`}
                  dir="ltr"
                  inputMode="decimal"
                  className="h-11 rounded-field-sm"
                  value={(m.effectType === 'MULTIPLIER' ? m.factor : m.amount) ?? ''}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : `${id}-hint`}
                  onChange={(event) =>
                    patch(
                      index,
                      m.effectType === 'MULTIPLIER'
                        ? { factor: event.target.value }
                        : { amount: event.target.value },
                    )
                  }
                />
                <p id={`${id}-hint`} className="text-meta text-text-secondary">
                  {t(`hint.${m.effectType}`)}
                </p>
              </div>
              {error ? (
                <p id={`${id}-error`} role="alert" className="text-meta text-error">
                  {t(`errors.${error}`)}
                </p>
              ) : null}
            </div>
          </article>
        );
      })}

      {modifiers.length < CATALOG_LIMITS.modifiers ? (
        <div className="flex flex-wrap items-end gap-2.5 rounded-row bg-surface-secondary px-4 py-3.5">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="add-modifier-question" className="text-meta text-text-secondary">
              {t('addFor')}
            </Label>
            <select
              id="add-modifier-question"
              className={SELECT_CLASS}
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
            >
              {questions.map((q) => (
                <option key={q.key} value={q.key}>
                  {q.label} ({q.key})
                </option>
              ))}
              <option value={NONE}>{t('noQuestion')}</option>
            </select>
          </div>
          <Button
            variant="white"
            onClick={() =>
              onChange([...modifiers, newModifier(adding === NONE ? null : (byKey.get(adding) ?? null))])
            }
          >
            <Plus aria-hidden />
            {t('addModifier')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MatchValue({
  id,
  modifier,
  question,
  onChange,
}: {
  id: string;
  modifier: EditorModifier;
  question: PricingQuestion | null;
  onChange: (value: unknown) => void;
}) {
  const t = useTranslations('AdminPricing');
  const options = question?.options ?? [];
  if (modifier.matchType === 'always' || modifier.matchType === 'is_true') return null;

  if (modifier.matchType === 'range') {
    const value = (modifier.matchValue ?? {}) as { min?: unknown; max?: unknown };
    return (
      <>
        {(['min', 'max'] as const).map((edge) => (
          <div key={edge} className="flex w-24 flex-col gap-1.5">
            <Label htmlFor={`${id}-${edge}`} className="text-meta text-text-secondary">
              {t(`range.${edge}`)}
            </Label>
            <Input
              id={`${id}-${edge}`}
              dir="ltr"
              inputMode="numeric"
              className="h-11 rounded-field-sm"
              value={String(value[edge] ?? '')}
              onChange={(event) => onChange({ ...value, [edge]: wholeOrText(event.target.value) })}
            />
          </div>
        ))}
      </>
    );
  }

  if (question?.type === 'number') {
    return (
      <div className="flex w-24 flex-col gap-1.5">
        <Label htmlFor={`${id}-equals`} className="text-meta text-text-secondary">
          {t('equalsValue')}
        </Label>
        <Input
          id={`${id}-equals`}
          dir="ltr"
          inputMode="numeric"
          className="h-11 rounded-field-sm"
          value={String(modifier.matchValue ?? '')}
          onChange={(event) => onChange(wholeOrText(event.target.value))}
        />
      </div>
    );
  }

  if (modifier.matchType === 'in') {
    return (
      <ToggleChips
        name={`${id}-in`}
        legend={t('anyOf')}
        options={options}
        values={Array.isArray(modifier.matchValue) ? (modifier.matchValue as string[]) : []}
        onChange={onChange}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-equals`} className="text-meta text-text-secondary">
        {t('equalsOption')}
      </Label>
      <select
        id={`${id}-equals`}
        className={SELECT_CLASS}
        value={String(modifier.matchValue ?? '')}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
