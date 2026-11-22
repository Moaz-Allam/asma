import type { ApplicationQuestionType } from './constants';
import type { ApplicationQuestion, RequestOwnApplication } from './schemas';

/**
 * Spec 0011-19b AC-3, AC-7: the application questions and the provider's own answers, in plain text for one locale.
 * The page localises every label on the server with `localized` and hands these to the client form, so no
 * localised JSON and no other provider's data reaches the browser. Pure: no `server-only`, so tests run it.
 */

export type FormQuestion = {
  key: string;
  label: string;
  help: string | null;
  type: ApplicationQuestionType;
  required: boolean;
  options: { value: string; label: string }[] | null;
  maxLength: number | null;
};

export type AnswerRow = { key: string; label: string; value: string };

type Text = (value: unknown) => string;

export function formQuestions(questions: readonly ApplicationQuestion[], text: Text): FormQuestion[] {
  return questions.map((question) => ({
    key: question.key,
    label: text(question.label),
    help: question.help_text ? text(question.help_text) : null,
    type: question.type,
    required: question.required,
    options: question.options
      ? question.options.map((option) => ({ value: option.value, label: text(option.label) }))
      : null,
    maxLength: question.max_length,
  }));
}

/**
 * The caller's own answers, read only, in the snapshot's order: the question as it was when they applied, a choice
 * through its option label, yes or no in words. Null for a message application.
 */
export function ownAnswerRows(
  application: RequestOwnApplication | null,
  text: Text,
  words: { yes: string; no: string },
): AnswerRow[] | null {
  if (!application?.application_answers || !application.questions_snapshot) return null;
  const answers = application.application_answers;
  return application.questions_snapshot.flatMap((question) => {
    const value = answers[question.key];
    if (value === undefined) return [];
    if (question.type === 'boolean')
      return typeof value === 'boolean'
        ? [{ key: question.key, label: text(question.label), value: value ? words.yes : words.no }]
        : [];
    if (question.type === 'single_select')
      return question.choice
        ? [{ key: question.key, label: text(question.label), value: text(question.choice.label) }]
        : [];
    return typeof value === 'string' ? [{ key: question.key, label: text(question.label), value }] : [];
  });
}

/** An `answers_invalid:<key>` refusal from the action, split into its code and the question it names. */
export function splitAnswerCode(error: string): { code: string; key: string | null } {
  const at = error.indexOf(':');
  if (at < 0) return { code: error, key: null };
  return { code: error.slice(0, at), key: error.slice(at + 1) || null };
}
