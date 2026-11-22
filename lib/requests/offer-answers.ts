/**
 * Spec 0011-19b AC-6: a provider's answers on the customer's offer card, in plain text for one locale. The page
 * renders them on the server through `localized` and hands lines to the card: the question's label from the
 * application's own snapshot, a choice through its option label, yes or no in words, and a text answer the scanner
 * matched as the hidden line. Pure: no `server-only`, so tests run it.
 */

export type OfferAnswerInput = {
  key: string;
  label: Record<string, string>;
  type: 'textarea' | 'single_select' | 'boolean';
  choice: { value: string; label: Record<string, string> } | null;
  value: string | boolean | null;
  hidden: boolean;
};

export type OfferAnswerLine = { key: string; label: string; value: string; hidden: boolean };

export function offerAnswerLines(
  answers: readonly OfferAnswerInput[] | null,
  text: (value: unknown) => string,
  words: { yes: string; no: string; hidden: string },
): OfferAnswerLine[] | null {
  if (answers === null) return null;
  return answers.flatMap((answer): OfferAnswerLine[] => {
    const label = text(answer.label);
    if (answer.hidden) return [{ key: answer.key, label, value: words.hidden, hidden: true }];
    if (answer.type === 'single_select')
      return answer.choice
        ? [{ key: answer.key, label, value: text(answer.choice.label), hidden: false }]
        : [];
    if (answer.type === 'boolean')
      return typeof answer.value === 'boolean'
        ? [{ key: answer.key, label, value: answer.value ? words.yes : words.no, hidden: false }]
        : [];
    return typeof answer.value === 'string'
      ? [{ key: answer.key, label, value: answer.value, hidden: false }]
      : [];
  });
}
