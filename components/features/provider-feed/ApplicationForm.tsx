'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { applyToRequest, loadMyProbation } from '@/actions/provider-feed';
import { ChoiceChips } from '@/components/shared/ChoiceChips';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { StatusChip } from '@/components/shared/StatusChip';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { track } from '@/lib/analytics/client';
import { useRouter } from '@/lib/i18n/navigation';
import { splitAnswerCode, type AnswerRow, type FormQuestion } from '@/lib/provider-feed/answers';
import { ANSWER_MAX, applicationTone, codePoints, MESSAGE_MAX } from '@/lib/provider-feed/constants';
import type { OwnApplication } from '@/lib/provider-feed/schemas';
import { instantLabel } from '@/lib/requests/view';

/**
 * The apply form on `p8` (ui-registry `ApplicationForm`, spec 0009 AC-9 to AC-11): one message with a live code
 * point counter, the standing warning, and "Apply, free" behind a confirm that restates the deal. No price
 * field, no live scan. A refusal keeps the message in the field; a full or closed request replaces the form with its
 * line. A replay shows the stored status.
 *
 * Spec 0011-19b AC-7: when the category has active application questions, the form asks them instead of the
 * message (a textarea with its counter, a radio group for a choice, yes or no) and sends back the version it was
 * drawn from. `questions_changed` refreshes the page so the current set shows; a refusal about one answer marks that
 * field. The provider's own answers show read only once sent.
 */

type Answer = string | boolean | null;

type Shown = 'form' | 'full' | 'closed';

export function ApplicationForm({
  requestId,
  application,
  state,
  timezone,
  paymentDeadline = null,
  questions = [],
  questionsVersion = null,
  ownAnswers = null,
}: {
  requestId: string;
  application: OwnApplication | null;
  state: Shown;
  timezone: string;
  /** Spec 0010 AC-12: set only when the caller's own application is SELECTED. */
  paymentDeadline?: string | null;
  /** Spec 0011-19b AC-3: the active questions, localised on the server; empty means the message form. */
  questions?: FormQuestion[];
  questionsVersion?: string | null;
  /** Spec 0011-19b AC-7: the caller's own sent answers, read only. */
  ownAnswers?: AnswerRow[] | null;
}) {
  const t = useTranslations('ProviderFeed');
  const locale = useLocale();
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [mine, setMine] = useState<OwnApplication | null>(application);
  const [fresh, setFresh] = useState(false);
  const [shown, setShown] = useState<Shown>(state);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (mine) {
    return (
      <section
        aria-live="polite"
        className="flex flex-col gap-3 rounded-panel bg-surface-secondary p-5 lg:p-6"
      >
        <StatusChip
          tone={applicationTone(mine.status)}
          label={mine.status === 'APPLIED' ? t('feed.applied') : t(`status.${mine.status}`)}
          className="self-start"
        />
        {fresh && mine.status === 'APPLIED' ? (
          <p role="status" className="text-body font-semibold text-text-primary">
            {t('form.applied')}
          </p>
        ) : null}
        {mine.status === 'SELECTED' && paymentDeadline ? (
          <p className="text-body font-semibold text-text-primary">
            {t('chosen.line', { date: instantLabel(paymentDeadline, timezone, locale) })}
          </p>
        ) : null}
        {mine.status === 'NOT_SELECTED' ? (
          <p className="text-body-s text-text-primary">{t('chosen.notChosen')}</p>
        ) : null}
        {mine.status === 'CANCELLED' ? (
          <p className="text-body-s text-text-primary">{t('chosen.cancelled')}</p>
        ) : null}
        <p className="text-body-s text-text-secondary">
          {t('form.appliedOn', { date: instantLabel(mine.created_at, timezone, locale) })}
        </p>
        {ownAnswers && ownAnswers.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-body-s font-bold text-text-primary">{t('form.yourAnswers')}</h3>
            <dl className="flex flex-col gap-3 rounded-block bg-surface p-4 text-body-s">
              {ownAnswers.map((row) => (
                <div key={row.key} className="flex flex-col gap-1">
                  <dt dir="auto" className="font-semibold text-text-primary">
                    {row.label}
                  </dt>
                  <dd dir="auto" className="break-words whitespace-pre-line text-text-secondary">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>
    );
  }

  if (shown !== 'form') {
    return (
      <p
        role="status"
        className="rounded-panel bg-surface-secondary p-5 text-body font-semibold text-text-primary"
      >
        {shown === 'full' ? t('form.full') : t('form.closed')}
      </p>
    );
  }

  const asked = questions.length > 0;

  function send() {
    start(async () => {
      setError(null);
      setFieldErrors({});
      let result: Awaited<ReturnType<typeof applyToRequest>>;
      try {
        result = await applyToRequest(
          asked
            ? {
                requestId,
                applicationMessage: null,
                applicationAnswers: Object.fromEntries(
                  questions.map((question) => {
                    const value = answers[question.key] ?? null;
                    return [question.key, typeof value === 'string' && value.trim() === '' ? null : value];
                  }),
                ),
                questionsVersion,
              }
            : { requestId, applicationMessage: message, applicationAnswers: null, questionsVersion: null },
        );
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      setConfirming(false);
      if (result.success) {
        if (!result.data.replayed) track('application_submitted', {});
        setFresh(!result.data.replayed);
        setMine(result.data.application);
        router.refresh();
        return;
      }
      if (result.error === 'request_full') {
        setShown('full');
        return;
      }
      if (result.error === 'request_closed') {
        setShown('closed');
        return;
      }
      if (result.error === 'probation_limit') {
        // Spec 0011-19a AC-6, X-22: the two figures are read again after the refusal.
        const read = await loadMyProbation({}).catch(() => null);
        const probation = read?.success ? read.data.probation : null;
        setError(
          probation
            ? t('form.probationLimit', { limit: probation.live_limit, needed: probation.jobs_needed })
            : t('errors.probation_limit'),
        );
        return;
      }
      if (result.error === 'questions_changed') {
        // AC-7: the set changed since the page was drawn; the refresh brings the current questions.
        setError(t('form.questionsChanged'));
        router.refresh();
        return;
      }
      const { code, key } = splitAnswerCode(result.error);
      if (key && (code === 'answers_invalid' || code === 'contact_info_in_answer')) {
        setFieldErrors({ [key]: t(`errors.${code}`) });
        setError(t('form.checkAnswers'));
        return;
      }
      setError(t(`errors.${code}` as 'errors.action_failed'));
    });
  }

  const count = codePoints(message);
  const setAnswer = (key: string, value: Answer) => setAnswers((current) => ({ ...current, [key]: value }));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-title-s text-text-primary">
        {asked ? t('form.questionsTitle') : t('form.title')}
      </h2>
      <p className="rounded-block bg-warning-light p-4 text-body-s text-warning-foreground">
        {asked ? t('form.answersWarning') : t('form.warning')}
      </p>
      {asked ? (
        <>
          {questions.map((question) => (
            <QuestionField
              key={question.key}
              question={question}
              value={answers[question.key] ?? null}
              error={fieldErrors[question.key] ?? null}
              onChange={(value) => setAnswer(question.key, value)}
              disabled={pending}
            />
          ))}
          {error ? (
            <p role="alert" className="text-meta text-error">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <FormField
          id="application-message"
          label={t('form.title')}
          error={error ?? undefined}
          note={<span aria-live="polite">{t('form.counter', { count, max: MESSAGE_MAX })}</span>}
        >
          <Textarea
            id="application-message"
            value={message}
            rows={5}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'application-message-error' : undefined}
            onChange={(e) => setMessage(e.target.value)}
          />
        </FormField>
      )}
      <Button size="block" disabled={pending} onClick={() => setConfirming(true)}>
        {t('form.submit')}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('form.confirmTitle')}
        body={t('form.confirmNow')}
        confirmLabel={pending ? t('form.sending') : t('form.confirmSend')}
        cancelLabel={t('form.confirmBack')}
        onConfirm={send}
        busy={pending}
      >
        <ul className="flex flex-col gap-2 rounded-block bg-surface-secondary p-4 text-body-s text-text-primary">
          <li>{t('form.confirmFree')}</li>
          <li>{t('form.confirmFee')}</li>
        </ul>
      </ConfirmDialog>
    </section>
  );
}

/**
 * A label in a locale other than the page's (a Turkish fallback on an Arabic page) keeps its own direction, so its
 * question mark stays on its own side (first strong isolate, then pop).
 */
function isolate(text: string): string {
  return String.fromCharCode(0x2068) + text + String.fromCharCode(0x2069);
}

/** One application question: its label, help text, a Required or Optional mark, the control and its own error. */
function QuestionField({
  question,
  value,
  error,
  onChange,
  disabled,
}: {
  question: FormQuestion;
  value: Answer;
  error: string | null;
  onChange: (value: Answer) => void;
  disabled: boolean;
}) {
  const t = useTranslations('ProviderFeed');
  const id = `answer-${question.key}`;
  const mark = question.required ? t('form.required') : t('form.optional');
  const errorLine = error ? (
    <p id={`${id}-error`} className="text-meta text-error">
      {error}
    </p>
  ) : null;
  const help = (
    <p id={`${id}-help`} className="text-meta text-text-secondary">
      {question.help ? `${question.help} · ${mark}` : mark}
    </p>
  );

  if (question.type === 'textarea') {
    const text = typeof value === 'string' ? value : '';
    const max = question.maxLength ?? ANSWER_MAX;
    return (
      <FormField
        id={id}
        label={isolate(question.label)}
        error={error}
        note={
          <span className="flex flex-wrap justify-between gap-2">
            <span>{question.help ? `${question.help} · ${mark}` : mark}</span>
            <span aria-live="polite">{t('form.counter', { count: codePoints(text), max })}</span>
          </span>
        }
      >
        <Textarea
          id={id}
          value={text}
          rows={4}
          dir="auto"
          maxLength={max}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    );
  }

  const options =
    question.type === 'boolean'
      ? [
          { value: 'yes', label: t('form.yes') },
          { value: 'no', label: t('form.no') },
        ]
      : (question.options ?? []);
  const current =
    question.type === 'boolean'
      ? value === true
        ? 'yes'
        : value === false
          ? 'no'
          : null
      : typeof value === 'string'
        ? value
        : null;
  return (
    <div className="flex flex-col gap-2">
      <ChoiceChips
        describedBy={error ? `${id}-help ${id}-error` : `${id}-help`}
        name={id}
        legend={isolate(question.label)}
        options={options}
        value={current}
        disabled={disabled}
        onChange={(picked) => onChange(question.type === 'boolean' ? picked === 'yes' : picked)}
      />
      {help}
      {errorLine}
    </div>
  );
}
