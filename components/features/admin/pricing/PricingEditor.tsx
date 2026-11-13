'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { previewFormula, publishFormula } from '@/actions/admin-pricing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/lib/i18n/navigation';
import { sameFormula } from '@/lib/catalog/compare';

import { FormulaPreview, type PreviewState } from './FormulaPreview';
import { PricingRulesEditor } from './PricingRulesEditor';
import type { EditorModifier, PricingAddon, PricingQuestion, PricingZone } from './types';

const PREVIEW_DELAY_MS = 400;

function toInput(modifiers: readonly EditorModifier[]) {
  return modifiers.map(({ questionKey, matchType, matchValue, effectType, amount, factor }) => ({
    questionKey,
    matchType,
    matchValue,
    effectType,
    amount,
    factor,
  }));
}

/**
 * `/admin/pricing` (`app-06`, spec 0007 AC-20, AC-21): the formula of one service beside its test panel.
 * The base price and each amount are typed in major units and parsed on the server; the total and every
 * line come back from the database. Publish names the version the page rendered, so a second admin who
 * published first makes this one reload with the new version (`stale_formula`).
 */
export function PricingEditor({
  serviceId,
  version,
  publishedBase,
  publishedModifiers,
  questions,
  addons,
  zones,
  currency,
}: {
  serviceId: string;
  version: number;
  publishedBase: string;
  publishedModifiers: EditorModifier[];
  questions: PricingQuestion[];
  addons: PricingAddon[];
  zones: PricingZone[];
  currency: 'TRY' | 'SAR';
}) {
  const t = useTranslations('AdminPricing');
  const router = useRouter();
  const [base, setBase] = useState(publishedBase);
  const [modifiers, setModifiers] = useState<EditorModifier[]>(publishedModifiers);
  const [errors, setErrors] = useState<Map<number, string>>(new Map());
  const [baseError, setBaseError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, startPublish] = useTransition();

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [zoneId, setZoneId] = useState<string | null>(null);
  // The last answer from the server, with the request it answered.
  const [answered, setAnswered] = useState<{ for: unknown; state: PreviewState } | null>(null);
  const latest = useRef(0);

  // A newer published version (this admin's or another's) resets the draft to it.
  const [shown, setShown] = useState(version);
  if (shown !== version) {
    setShown(version);
    setBase(publishedBase);
    setModifiers(publishedModifiers);
  }

  const dirty = !sameFormula(
    { base, modifiers: toInput(modifiers) },
    { base: publishedBase, modifiers: toInput(publishedModifiers) },
  );
  const complete = questions.every(
    (q) => !q.required || q.type === 'multi_select' || answers[q.key] !== undefined,
  );
  const request = useMemo(
    () => ({ serviceId, basePrice: base, modifiers: toInput(modifiers), zoneId, addonIds, answers }),
    [serviceId, base, modifiers, zoneId, addonIds, answers],
  );

  // A change asks the server after 400 ms; an answer that comes back late never replaces a newer one.
  useEffect(() => {
    const id = ++latest.current;
    if (!complete) return;
    const timer = setTimeout(async () => {
      const result = await previewFormula(request);
      if (id !== latest.current) return;
      let state: PreviewState;
      if (!result.success) {
        state = { kind: 'message', code: result.error === 'forbidden' ? 'forbidden' : 'failed' };
      } else if (result.data.status === 'ok') {
        state = { kind: 'ok', result: result.data.preview };
      } else if (result.data.status === 'invalid') {
        state = { kind: 'message', code: 'invalidAnswers' };
      } else if (result.data.status === 'invalid_formula') {
        state = { kind: 'message', code: 'invalidFormula' };
      } else {
        state = { kind: 'message', code: result.data.status };
      }
      setAnswered({ for: request, state });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [request, complete]);

  const preview: PreviewState = !complete
    ? { kind: 'idle' }
    : answered?.for === request
      ? answered.state
      : { kind: 'loading' };

  function publish() {
    setNotice(null);
    startPublish(async () => {
      const result = await publishFormula({
        serviceId,
        expectedVersion: version,
        basePrice: base,
        modifiers: toInput(modifiers),
      });
      if (!result.success) {
        if (result.error === 'stale_formula') {
          setNotice(t('stale'));
          router.refresh();
          return;
        }
        setNotice(t(result.error === 'forbidden' ? 'publishForbidden' : 'publishFailed'));
        return;
      }
      const data = result.data;
      if (data.status === 'invalid_formula') {
        const byIndex = new Map<number, string>();
        let baseCode: string | null = null;
        for (const error of data.errors) {
          if (error.index === null) baseCode = error.code;
          else if (!byIndex.has(error.index)) byIndex.set(error.index, error.code);
        }
        setErrors(byIndex);
        setBaseError(baseCode);
        setNotice(t('fixCards'));
        return;
      }
      setErrors(new Map());
      setBaseError(null);
      setNotice(data.status === 'ok' ? t('published', { version: data.version }) : t('noChanges'));
      router.refresh();
    });
  }

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section
        aria-labelledby="formula-title"
        className="rounded-block border-2 border-border px-5 py-6 lg:px-6.5"
      >
        <h2 id="formula-title" className="sr-only">
          {t('formulaTitle')}
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-3.5 rounded-row bg-surface-secondary px-4.5 py-4">
          <span className="w-5.5 font-display text-body-s text-text-secondary">0</span>
          <Label htmlFor="base-price" className="flex-1 text-label">
            {t('basePrice', { currency })}
          </Label>
          <Input
            id="base-price"
            dir="ltr"
            inputMode="decimal"
            className="h-11 w-36 rounded-field-sm bg-surface"
            value={base}
            aria-invalid={baseError ? true : undefined}
            aria-describedby={baseError ? 'base-price-error' : undefined}
            onChange={(event) => setBase(event.target.value)}
          />
          {baseError ? (
            <p id="base-price-error" role="alert" className="w-full text-meta text-error">
              {t(`errors.${baseError}`)}
            </p>
          ) : null}
        </div>

        <PricingRulesEditor
          modifiers={modifiers}
          onChange={(next) => {
            setModifiers(next);
            setErrors(new Map());
          }}
          questions={questions}
          errors={errors}
          currency={currency}
        />

        <p className="mt-3 rounded-field-sm bg-surface-secondary px-4 py-3 text-body-s font-semibold text-text-secondary">
          {t('thenLine')}
        </p>

        <div className="mt-4.5 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            variant={dirty ? 'primary' : 'secondary'}
            disabled={!dirty || publishing}
            onClick={publish}
          >
            {dirty ? t('publish', { version: version + 1 }) : t('publishedNoChanges')}
          </Button>
          <p className="flex-1 text-meta text-text-secondary">{t('keepsPrice')}</p>
        </div>
        {notice ? (
          <p
            role="status"
            className="mt-3 rounded-field-sm bg-info-light px-4 py-3 text-body-s text-info-foreground"
          >
            {notice}
          </p>
        ) : null}
      </section>

      <FormulaPreview
        questions={questions}
        addons={addons}
        zones={zones}
        answers={answers}
        onAnswer={(key, value) =>
          setAnswers((current) => {
            const next = { ...current };
            if (value === undefined) delete next[key];
            else next[key] = value;
            return next;
          })
        }
        addonIds={addonIds}
        onAddons={setAddonIds}
        zoneId={zoneId}
        onZone={setZoneId}
        state={preview}
        currency={currency}
      />
    </div>
  );
}
