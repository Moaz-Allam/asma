'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { StatusChip } from '@/components/shared/StatusChip';
import { ToggleChips } from '@/components/shared/ToggleChips';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { PricedResult } from '@/lib/pricing';

import type { PricingAddon, PricingQuestion, PricingZone } from './types';

export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'loading' }
  | { kind: 'ok'; result: PricedResult }
  | { kind: 'message'; code: string };

const NO_ZONE = '__none__';

/**
 * Try the draft (ui-registry `FormulaPreview`, `app-06`, spec 0007 AC-21): a control per priced question,
 * addon switches and zone chips. It starts empty, with no zone, and shows no total until every required
 * priced question is answered. Every figure, the total and each line fired or not, comes from the server.
 */
export function FormulaPreview({
  questions,
  addons,
  zones,
  answers,
  onAnswer,
  addonIds,
  onAddons,
  zoneId,
  onZone,
  state,
  currency,
}: {
  questions: PricingQuestion[];
  addons: PricingAddon[];
  zones: PricingZone[];
  answers: Record<string, unknown>;
  onAnswer: (key: string, value: unknown) => void;
  addonIds: string[];
  onAddons: (ids: string[]) => void;
  zoneId: string | null;
  onZone: (id: string | null) => void;
  state: PreviewState;
  currency: 'TRY' | 'SAR';
}) {
  const t = useTranslations('AdminPricing');
  const labelOf = new Map(questions.map((q) => [q.key, q.label]));

  return (
    <aside aria-labelledby="preview-title" className="flex flex-col gap-3.5">
      <section className="rounded-block bg-accent-light px-6.5 py-6">
        <h2 id="preview-title" className="text-chip text-text-primary">
          {t('tryTitle')}
        </h2>
        <div className="mt-2 mb-4 min-h-14" aria-live="polite">
          {state.kind === 'ok' ? (
            <MoneyDisplay
              amount={state.result.price}
              currency={currency}
              className="text-quick text-text-primary"
            />
          ) : (
            <p className="text-body-s text-text-primary">
              {state.kind === 'message'
                ? t(`preview.${state.code}`)
                : state.kind === 'loading'
                  ? t('preview.loading')
                  : t('preview.answerFirst')}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-4 rounded-row bg-surface px-4.5 py-4">
          {questions.length === 0 ? (
            <p className="text-body-s text-text-secondary">{t('noPricedQuestions')}</p>
          ) : null}
          {questions.map((q) => (
            <PreviewControl
              key={q.key}
              question={q}
              value={answers[q.key]}
              onChange={(v) => onAnswer(q.key, v)}
            />
          ))}
          {addons.map((addon) => (
            <label key={addon.id} className="flex min-h-11 items-center gap-3">
              <span className="flex-1 text-body-s font-semibold text-text-primary">
                {t('addonLabel', { name: addon.name })}
                {addon.active ? null : <span className="text-meta text-text-secondary"> · {t('off')}</span>}
              </span>
              <Switch
                checked={addonIds.includes(addon.id)}
                onCheckedChange={(on) =>
                  onAddons(on ? [...addonIds, addon.id] : addonIds.filter((id) => id !== addon.id))
                }
                aria-label={t('addonLabel', { name: addon.name })}
              />
            </label>
          ))}
          <ChoiceChips
            name="preview-zone"
            legend={t('zone')}
            options={[
              { value: NO_ZONE, label: t('noZone') },
              ...zones.map((z) => ({ value: z.id, label: `${z.name} ×${z.multiplier}` })),
            ]}
            value={zoneId ?? NO_ZONE}
            onChange={(value) => onZone(value === NO_ZONE ? null : value)}
          />
          {zoneId === null ? <p className="text-meta text-text-secondary">{t('noZoneNote')}</p> : null}
        </div>
      </section>

      <section aria-labelledby="breakdown-title" className="rounded-block border-2 border-border px-5.5 py-5">
        <h2 id="breakdown-title" className="mb-3 font-display text-group text-text-primary">
          {t('breakdownTitle')}
        </h2>
        {state.kind === 'ok' ? (
          <dl className="flex flex-col gap-2.5 text-body-s">
            <Line label={t('line.base')}>
              <MoneyDisplay amount={state.result.breakdown.base} currency={currency} />
            </Line>
            {state.result.breakdown.modifiers.map((line, index) => (
              <Line
                key={index}
                label={`${index + 1}. ${line.question_key ? (labelOf.get(line.question_key) ?? line.question_key) : t('noQuestion')}`}
                chip={
                  <StatusChip
                    tone={line.fired ? 'info' : 'neutral'}
                    label={t(line.fired ? 'fired' : 'notFired')}
                  />
                }
              >
                {line.effect_type === 'MULTIPLIER' ? (
                  <span dir="ltr">×{line.factor}</span>
                ) : line.effect_type === 'PER_UNIT' ? (
                  <span dir="ltr" className="inline-flex gap-1">
                    <MoneyDisplay amount={line.amount ?? 0} currency={currency} />
                    {line.units !== null ? <span>× {line.units}</span> : null}
                  </span>
                ) : (
                  <MoneyDisplay amount={line.amount ?? 0} currency={currency} />
                )}
              </Line>
            ))}
            {state.result.breakdown.addons.map((addon) => (
              <Line
                key={addon.id}
                label={t('line.addon', { name: addons.find((a) => a.id === addon.id)?.name ?? '' })}
              >
                <MoneyDisplay amount={addon.price} currency={currency} />
              </Line>
            ))}
            <Line label={t('line.zone')}>
              <span dir="ltr">×{state.result.breakdown.zone?.multiplier ?? '1'}</span>
            </Line>
            <Line label={t('line.unrounded')}>
              <span dir="ltr" className="font-mono">
                {state.result.breakdown.unrounded}
              </span>
            </Line>
            <Line label={t('line.rounding')}>
              <MoneyDisplay amount={state.result.breakdown.rounding_minor} currency={currency} />
            </Line>
          </dl>
        ) : (
          <p className="text-body-s text-text-secondary">{t('breakdownEmpty')}</p>
        )}
      </section>
    </aside>
  );
}

function Line({ label, chip, children }: { label: string; chip?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <dt className="flex items-center gap-2 text-text-primary">
        {label}
        {chip}
      </dt>
      <dd className="font-display text-text-primary tabular-nums">{children}</dd>
    </div>
  );
}

function PreviewControl({
  question,
  value,
  onChange,
}: {
  question: PricingQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useTranslations('AdminPricing');
  const id = `preview-${question.key}`;
  const label = `${question.label}${question.required ? '' : ` · ${t('optional')}`}`;

  if (question.type === 'number') {
    return (
      <div className="flex items-center gap-3">
        <Label htmlFor={id} className="flex-1 text-body-s font-semibold">
          {label}
        </Label>
        <Input
          id={id}
          dir="ltr"
          inputMode="numeric"
          className="h-11 w-24 rounded-field-sm"
          value={value === undefined ? '' : String(value)}
          onChange={(event) => {
            const text = event.target.value.trim();
            onChange(text === '' ? undefined : /^[0-9]{1,6}$/.test(text) ? Number(text) : text);
          }}
        />
      </div>
    );
  }
  if (question.type === 'boolean') {
    return (
      <ChoiceChips
        name={id}
        legend={label}
        options={[
          { value: 'yes', label: t('yes') },
          { value: 'no', label: t('no') },
        ]}
        value={value === true ? 'yes' : value === false ? 'no' : null}
        onChange={(v) => onChange(v === 'yes')}
      />
    );
  }
  if (question.type === 'multi_select') {
    return (
      <ToggleChips
        name={id}
        legend={label}
        options={question.options ?? []}
        values={Array.isArray(value) ? (value as string[]) : []}
        onChange={(values) => onChange(values)}
      />
    );
  }
  return (
    <ChoiceChips
      name={id}
      legend={label}
      options={question.options ?? []}
      value={typeof value === 'string' ? value : null}
      onChange={(v) => onChange(v)}
    />
  );
}
