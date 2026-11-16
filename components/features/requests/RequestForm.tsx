'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { createRequestAction, quoteRequestAction } from '@/actions/requests';
import { FlowHeader } from '@/components/layout/FlowHeader';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { FormField } from '@/components/shared/FormField';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PriceCard, type PriceFigures } from '@/components/shared/PriceCard';
import { ToggleRow } from '@/components/shared/ToggleRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { track } from '@/lib/analytics/client';
import { useRouter } from '@/lib/i18n/navigation';
import { isBlankAnswer, trimBlank } from '@/lib/requests/blank';
import type { RequestQuote } from '@/lib/requests/schemas';
import {
  allowedDates,
  allowedHours,
  dayParts,
  expectedEnd,
  hourLabel,
  quoteLines,
  type FormCatalog,
  type FormQuestion,
  type FormService,
} from '@/lib/requests/view';
import { cn } from '@/lib/utils';

import { DynamicQuestionForm } from './DynamicQuestionForm';

/**
 * `/requests/new` (spec 0008 AC-6, AC-19 to AC-22): two steps on one page, `s4` then `s5`. The form asks for
 * a quote 400 ms after the last change, and a late answer never replaces a newer one. Every figure shown
 * is the server's (rule 1). Publish sends the last figures shown as expected figures only; a moved price
 * comes back as `price_changed` and the review step asks again. The client key is made once, when the form
 * opens, so a double tap or a retry creates one request (AC-12).
 */

export type RequestFormInitial = {
  categoryId: string | null;
  serviceId: string | null;
  answers: Record<string, unknown>;
  addonIds: string[];
  zoneId: string | null;
  addressLine: string;
  notes: string;
};

type QuoteState =
  | { kind: 'missing'; reason: 'needService' | 'needAnswers' | 'needDistrict' }
  | { kind: 'checking' }
  | { kind: 'ok'; quote: RequestQuote }
  | { kind: 'invalid' }
  | { kind: 'refused'; code: string };

type Field = 'date' | 'hour' | 'line' | 'notes';

const QUOTE_WAIT_MS = 400;
const UNPRICED_TYPES: ReadonlySet<string> = new Set(['text', 'textarea', 'date', 'time']);
const MAX_ZONE_CHIPS = 8;
const LINE_MIN = 5;
const LINE_MAX = 200;
const NOTES_MAX = 500;
const FIELD_CODES: Readonly<Record<string, Field>> = {
  schedule_invalid: 'date',
  address_invalid: 'line',
  notes_invalid: 'notes',
  contact_info_in_notes: 'notes',
};

function findService(catalog: FormCatalog, id: string | null): FormService | null {
  for (const c of catalog.categories) {
    const s = c.services.find((x) => x.id === id);
    if (s) return s;
  }
  return null;
}

function without<T extends Record<string, unknown>>(record: T, key: string): T {
  const next = { ...record };
  delete next[key];
  return next;
}

export function RequestForm({
  catalog,
  locale,
  initial,
  repeated,
  serviceGone,
}: {
  catalog: FormCatalog;
  locale: string;
  initial: RequestFormInitial;
  repeated: boolean;
  serviceGone: boolean;
}) {
  const t = useTranslations('Requests');
  const router = useRouter();
  const [clientKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [categoryId, setCategoryId] = useState<string | null>(
    initial.categoryId ?? (catalog.categories.length === 1 ? (catalog.categories[0]?.id ?? null) : null),
  );
  const [serviceId, setServiceId] = useState<string | null>(initial.serviceId);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial.answers);
  const [addonIds, setAddonIds] = useState<string[]>(initial.addonIds);
  const [zoneId, setZoneId] = useState<string | null>(initial.zoneId);
  const [date, setDate] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [line, setLine] = useState(initial.addressLine);
  const [notes, setNotes] = useState(initial.notes);
  const [answered, setAnswered] = useState<{ key: string; state: QuoteState } | null>(null);
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
  const [isPublishing, startPublish] = useTransition();

  const category = catalog.categories.find((c) => c.id === categoryId) ?? null;
  const service = findService(catalog, serviceId);
  const dates = useMemo(
    () => allowedDates(catalog.today, catalog.schedule.leadDays, catalog.schedule.horizonDays),
    [catalog.today, catalog.schedule.leadDays, catalog.schedule.horizonDays],
  );
  const hours = allowedHours(catalog.schedule.firstHour, catalog.schedule.lastHour);
  const general = service?.questions.filter((q) => !q.serviceScoped) ?? [];
  const own = service?.questions.filter((q) => q.serviceScoped) ?? [];

  // The answers of the questions this service asks, and nothing else.
  const sentAnswers: Record<string, unknown> = {};
  for (const q of service?.questions ?? [])
    if (answers[q.key] !== undefined) sentAnswers[q.key] = answers[q.key];
  // Text, dates and times never change a price (spec 0007), so typing in them asks for no new quote and
  // spends nothing of the hourly limit (AC-28, review 2026-11-16). They still travel with every quote, from
  // a ref, so the server checks them; a change of their blank state moves `missing` and asks again.
  const priced: Record<string, unknown> = {};
  const unpriced: Record<string, unknown> = {};
  for (const q of service?.questions ?? []) {
    if (sentAnswers[q.key] === undefined) continue;
    (UNPRICED_TYPES.has(q.type) ? unpriced : priced)[q.key] = sentAnswers[q.key];
  }
  const sentKey = JSON.stringify([serviceId, zoneId, addonIds, priced]);
  const unpricedRef = useRef(unpriced);
  useEffect(() => {
    unpricedRef.current = unpriced;
  });

  // What is missing before a quote can be asked (AC-6), read on every render.
  let missing: 'needService' | 'needAnswers' | 'needDistrict' | null = null;
  if (!service) missing = 'needService';
  else if (service.questions.some((q) => q.required && isBlankAnswer(sentAnswers[q.key])))
    missing = 'needAnswers';
  else if (!zoneId) missing = 'needDistrict';

  // The answer belongs to the inputs it was asked for; a late one for older inputs is never shown.
  let quote: QuoteState;
  if (missing) quote = { kind: 'missing', reason: missing };
  else if (answered?.key === sentKey) quote = answered.state;
  else quote = { kind: 'checking' };

  useEffect(() => {
    if (missing) return;
    const key = sentKey;
    const [sId, zId, aIds, ans] = JSON.parse(key) as [string, string, string[], Record<string, unknown>];
    const timer = setTimeout(async () => {
      let result: Awaited<ReturnType<typeof quoteRequestAction>>;
      try {
        result = await quoteRequestAction({
          serviceId: sId,
          zoneId: zId,
          addonIds: aIds,
          answers: { ...ans, ...unpricedRef.current },
        });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        setAnswered({ key, state: { kind: 'refused', code: result.error } });
      } else if (result.data.status === 'ok') {
        setAnswerErrors({});
        setAnswered({ key, state: { kind: 'ok', quote: result.data.quote } });
      } else {
        setAnswerErrors(Object.fromEntries(result.data.errors.map((e) => [e.key ?? '', e.code])));
        setAnswered({ key, state: { kind: 'invalid' } });
      }
    }, QUOTE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [sentKey, missing]);

  function chooseService(id: string) {
    setServiceId(id);
    const next = findService(catalog, id);
    setAddonIds((ids) => ids.filter((a) => next?.addons.some((x) => x.id === a)));
    setAnswerErrors({});
  }

  function setAnswer(key: string, value: unknown) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setAnswerErrors((e) => without(e, key));
  }

  const figures: PriceFigures | null =
    quote.kind === 'ok' && service
      ? {
          price: quote.quote.price,
          commission: quote.quote.commission,
          cashDue: quote.quote.cash_due,
          currency: quote.quote.currency,
          lines: quoteLines(
            quote.quote.breakdown,
            {
              questions: Object.fromEntries(service.questions.map((q) => [q.key, q.label])),
              addons: Object.fromEntries(service.addons.map((a) => [a.id, a.name])),
              zones: Object.fromEntries(catalog.zones.map((z) => [z.id, z.name])),
            },
            { base: service.name, adjustment: t('price.adjustment') },
          ),
        }
      : null;

  let placeholder: string | null = null;
  if (quote.kind === 'missing') placeholder = t(`price.${quote.reason}`);
  else if (quote.kind === 'checking') placeholder = t('price.checking');
  else if (quote.kind === 'invalid') placeholder = t('form.fixBelow');
  else if (quote.kind === 'refused') placeholder = t(`errors.${quote.code}` as 'errors.action_failed');

  function toReview() {
    const errors: Partial<Record<Field, string>> = {};
    const lineLength = [...trimBlank(line)].length;
    if (!date) errors.date = t('errors.schedule_invalid');
    if (hour === null) errors.hour = t('errors.schedule_invalid');
    if (lineLength < LINE_MIN || lineLength > LINE_MAX) errors.line = t('errors.address_invalid');
    if ([...trimBlank(notes)].length > NOTES_MAX) errors.notes = t('errors.notes_invalid');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || quote.kind !== 'ok') return;
    setBanner(null);
    setPriceChanged(false);
    setStep('review');
    window.scrollTo({ top: 0 });
  }

  function publish() {
    if (quote.kind !== 'ok' || !service || !zoneId || !date || hour === null) return;
    const shown = quote.quote;
    startPublish(async () => {
      setBanner(null);
      let result: Awaited<ReturnType<typeof createRequestAction>>;
      try {
        result = await createRequestAction({
          clientKey,
          serviceId: service.id,
          zoneId,
          addonIds,
          answers: sentAnswers,
          startDate: date,
          startHour: hour,
          addressLine: line,
          notes: trimBlank(notes) === '' ? null : notes,
          expectedPrice: shown.price,
          expectedCommission: shown.commission,
        });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (result.success && result.data.status === 'ok') {
        track('request_posted', { repeated });
        router.push(`/requests/${result.data.id}?posted=1`);
        return;
      }
      if (result.success && result.data.status === 'price_changed') {
        setAnswered({ key: sentKey, state: { kind: 'ok', quote: result.data.quote } });
        setPriceChanged(true);
        return;
      }
      if (result.success && result.data.status === 'invalid') {
        setAnswerErrors(Object.fromEntries(result.data.errors.map((e) => [e.key ?? '', e.code])));
        setStep('form');
        setBanner(t('form.fixBelow'));
        return;
      }
      const code = result.success ? 'action_failed' : result.error;
      const message = t(`errors.${code}` as 'errors.action_failed');
      const field = FIELD_CODES[code];
      if (field) {
        setFieldErrors({ [field]: message });
        setStep('form');
      }
      if (code === 'schedule_invalid') {
        setDate(null);
        setHour(null);
        router.refresh();
      }
      setBanner(message);
    });
  }

  const steps = [
    { label: t('flow.details'), state: step === 'form' ? 'current' : 'done' },
    { label: t('flow.review'), state: step === 'review' ? 'current' : 'next' },
    { label: t('flow.offers'), state: 'next' },
  ] as const;

  const priceLabels = {
    online: t('price.online'),
    cash: t('price.cash'),
    total: t('price.total'),
    breakdown: t('price.breakdown'),
  };

  const bannerNode = banner ? (
    <p
      role="alert"
      className="rounded-block bg-error-light p-4 text-body-s font-semibold text-error-foreground"
    >
      {banner}
    </p>
  ) : null;

  if (step === 'review' && service && date && hour !== null && quote.kind === 'ok') {
    const end = expectedEnd(date, hour, service.hoursMax);
    const zone = catalog.zones.find((z) => z.id === zoneId);
    const answered = service.questions.filter((q) => !isBlankAnswer(sentAnswers[q.key]));
    const list = new Intl.ListFormat(locale, { type: 'conjunction' });
    const chosen = service.addons.filter((a) => addonIds.includes(a.id)).map((a) => a.name);
    return (
      <div className="flex flex-col gap-5">
        <FlowHeader
          label={t('flow.label')}
          steps={steps}
          exit={{ label: t('flow.back'), onClick: () => setStep('form') }}
        />
        <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex min-w-0 flex-col gap-5">
            <h1 className="font-display text-title text-text-primary">{t('review.title')}</h1>
            {bannerNode}
            {priceChanged ? (
              <p
                role="alert"
                className="rounded-block bg-warning-light p-4 text-body-s font-semibold text-warning-foreground"
              >
                {t('review.priceChanged')}
              </p>
            ) : null}
            <dl className="divide-y divide-border-light rounded-panel border border-border-light bg-surface">
              <ReviewRow term={t('review.service')} value={`${category?.name ?? ''} · ${service.name}`} />
              {answered.map((q) => (
                <ReviewRow key={q.key} term={q.label} value={answerText(q, sentAnswers[q.key], t)} />
              ))}
              <ReviewRow
                term={t('review.addons')}
                value={chosen.length > 0 ? list.format(chosen) : t('review.none')}
              />
              <ReviewRow
                term={t('review.start')}
                value={`${dayParts(date, locale).long} · ${hourLabel(hour, locale)}`}
              />
              <ReviewRow
                term={t('review.end')}
                value={`${dayParts(end.date, locale).long} · ${hourLabel(end.hour, locale)} · ${t(
                  'review.estimate',
                  {
                    min: service.hoursMin,
                    max: service.hoursMax,
                  },
                )}`}
              />
              <ReviewRow term={t('review.district')} value={zone?.name ?? ''} />
              <ReviewRow term={t('review.line')} value={trimBlank(line)} />
              <ReviewRow term={t('review.notes')} value={trimBlank(notes) || t('review.none')} />
            </dl>
            <section className="flex flex-col gap-3 rounded-panel bg-accent-light p-5 lg:p-7.5">
              <h2 className="font-display text-section text-text-primary">{t('review.beforeTitle')}</h2>
              <ul className="flex list-disc flex-col gap-2 ps-5 text-body text-text-primary">
                <li>{t('review.before1')}</li>
                <li>{t('review.before2')}</li>
                <li>{t('review.before3')}</li>
                <li>{t('review.before4')}</li>
              </ul>
            </section>
          </div>
          <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
            <PriceCard
              eyebrow={t('price.eyebrow')}
              figures={figures}
              labels={priceLabels}
              note={t('review.noCharge')}
            >
              <Button size="block" onClick={publish} disabled={isPublishing}>
                {isPublishing ? t('review.publishing') : t('review.publish')}
              </Button>
              <Button
                variant="link"
                size="text"
                onClick={() => setStep('form')}
                className="min-h-11 self-center"
              >
                {t('review.edit')}
              </Button>
            </PriceCard>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FlowHeader
        label={t('flow.label')}
        steps={steps}
        exit={{ label: t('flow.cancel'), href: '/requests' }}
      />
      <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-7">
          <header className="flex flex-col gap-3">
            <h1 className="font-display text-title text-text-primary">{t('form.title')}</h1>
            <p className="max-w-60ch text-body text-text-lede">{t('form.intro')}</p>
          </header>
          {repeated ? (
            <p className="rounded-block bg-info-light p-4 text-body-s text-info-foreground">
              {t('form.repeated')}
            </p>
          ) : null}
          {serviceGone ? (
            <p
              role="status"
              className="rounded-block bg-warning-light p-4 text-body-s text-warning-foreground"
            >
              {t('form.serviceGone')}
            </p>
          ) : null}
          {bannerNode}

          {catalog.categories.length > 1 ? (
            <ChoiceChips
              name="category"
              legend={t('form.category')}
              options={catalog.categories.map((c) => ({ value: c.id, label: c.name }))}
              value={categoryId}
              onChange={(id) => {
                setCategoryId(id);
                if (!catalog.categories.find((c) => c.id === id)?.services.some((s) => s.id === serviceId)) {
                  setServiceId(null);
                }
              }}
            />
          ) : null}

          {category ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 font-display text-section text-text-primary">
                {t('form.service')}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {category.services.map((s) => {
                  const checked = s.id === serviceId;
                  return (
                    <label
                      key={s.id}
                      className={cn(
                        'flex min-h-20 cursor-pointer flex-col justify-center gap-1 rounded-block px-5 py-4 transition',
                        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                        checked
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-surface-secondary text-text-primary',
                      )}
                    >
                      <input
                        type="radio"
                        name="service"
                        value={s.id}
                        checked={checked}
                        onChange={() => chooseService(s.id)}
                        className="sr-only"
                      />
                      <span className="text-body font-bold">{s.name}</span>
                      {s.note ? <span className="text-meta">{s.note}</span> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {service && general.length > 0 ? (
            <section className="flex flex-col gap-4">
              <SectionTitle title={t('form.general')} chip={t('form.generalNote')} />
              <DynamicQuestionForm
                idPrefix="q"
                questions={general}
                answers={answers}
                errors={answerErrors}
                onChange={setAnswer}
              />
            </section>
          ) : null}
          {service && own.length > 0 ? (
            <section className="flex flex-col gap-4">
              <SectionTitle
                title={t('form.serviceQuestions', { service: service.name })}
                chip={t('form.serviceNote')}
              />
              <DynamicQuestionForm
                idPrefix="q"
                questions={own}
                answers={answers}
                errors={answerErrors}
                onChange={setAnswer}
              />
            </section>
          ) : null}
          {service && service.addons.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionTitle title={t('form.addons', { service: service.name })} />
              <div className="grid gap-3 sm:grid-cols-2">
                {service.addons.map((a) => (
                  <ToggleRow
                    key={a.id}
                    id={`addon-${a.id}`}
                    label={a.name}
                    end={<MoneyDisplay amount={a.price} currency={catalog.currency} />}
                    checked={addonIds.includes(a.id)}
                    onChange={(on) =>
                      setAddonIds((ids) => (on ? [...ids, a.id] : ids.filter((x) => x !== a.id)))
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}

          {service ? (
            <>
              <section className="flex flex-col gap-4">
                <SectionTitle title={t('form.address')} />
                {catalog.zones.length <= MAX_ZONE_CHIPS ? (
                  <ChoiceChips
                    name="district"
                    legend={t('form.district')}
                    options={catalog.zones.map((z) => ({ value: z.id, label: z.name }))}
                    value={zoneId}
                    onChange={setZoneId}
                  />
                ) : (
                  <FormField id="district" label={t('form.district')}>
                    <select
                      id="district"
                      value={zoneId ?? ''}
                      onChange={(e) => setZoneId(e.target.value || null)}
                      className="min-h-12 rounded-field border border-input bg-surface px-4 text-body text-text-primary"
                    >
                      <option value="">{t('form.districtPlaceholder')}</option>
                      {catalog.zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                )}
                <FormField
                  id="line"
                  label={t('form.line')}
                  error={fieldErrors.line}
                  note={t('form.linePrivacy')}
                >
                  <Input
                    id="line"
                    value={line}
                    maxLength={LINE_MAX + 20}
                    autoComplete="street-address"
                    aria-invalid={fieldErrors.line ? true : undefined}
                    aria-describedby={fieldErrors.line ? 'line-error' : undefined}
                    onChange={(e) => setLine(e.target.value)}
                  />
                </FormField>
              </section>

              <section className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <ChoiceChips
                    name="date"
                    legend={t('form.date')}
                    options={dates.map((d) => {
                      const p = dayParts(d, locale);
                      return { value: d, label: `${p.weekday} ${p.day}` };
                    })}
                    value={date}
                    onChange={(d) => {
                      setDate(d);
                      setFieldErrors((e) => without(e, 'date'));
                    }}
                  />
                  {fieldErrors.date ? <p className="text-meta text-error">{fieldErrors.date}</p> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <ChoiceChips
                    name="hour"
                    legend={t('form.hour')}
                    options={hours.map((h) => ({ value: String(h), label: hourLabel(h, locale) }))}
                    value={hour === null ? null : String(hour)}
                    onChange={(h) => {
                      setHour(Number(h));
                      setFieldErrors((e) => without(e, 'hour'));
                    }}
                  />
                  {fieldErrors.hour ? <p className="text-meta text-error">{fieldErrors.hour}</p> : null}
                </div>
              </section>

              <FormField
                id="notes"
                label={t('form.notes')}
                error={fieldErrors.notes}
                note={t('answers.count', { count: [...notes].length, max: NOTES_MAX })}
              >
                <Textarea
                  id="notes"
                  value={notes}
                  maxLength={NOTES_MAX + 20}
                  aria-invalid={fieldErrors.notes ? true : undefined}
                  aria-describedby={fieldErrors.notes ? 'notes-error' : undefined}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </FormField>
            </>
          ) : null}
        </div>

        <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
          <PriceCard
            eyebrow={t('price.eyebrow')}
            figures={figures}
            placeholder={placeholder}
            labels={priceLabels}
            note={t('price.note')}
          >
            {service ? (
              <p className="text-meta text-text-secondary">
                {t('price.estimate', { min: service.hoursMin, max: service.hoursMax })}
              </p>
            ) : null}
            <Button size="block" onClick={toReview} disabled={quote.kind !== 'ok'}>
              {t('form.toReview')}
            </Button>
          </PriceCard>
        </aside>
      </div>
    </div>
  );
}

function SectionTitle({ title, chip }: { title: string; chip?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-display text-section text-text-primary">{title}</h2>
      {chip ? (
        <span className="rounded-full bg-surface-secondary px-3 py-1 text-chip text-text-secondary">
          {chip}
        </span>
      ) : null}
    </div>
  );
}

function ReviewRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="grid gap-1 px-5 py-4 sm:grid-cols-[1fr_2fr]">
      <dt className="text-body-s text-text-secondary">{term}</dt>
      <dd className="text-body-s font-semibold break-words text-text-primary">{value}</dd>
    </div>
  );
}

function answerText(
  q: FormQuestion,
  value: unknown,
  t: (key: 'answers.yes' | 'answers.no') => string,
): string {
  if (typeof value === 'boolean') return value ? t('answers.yes') : t('answers.no');
  if (Array.isArray(value)) {
    return value.map((v) => q.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ');
  }
  if (typeof value === 'string' && q.options) return q.options.find((o) => o.value === value)?.label ?? value;
  return String(value);
}
