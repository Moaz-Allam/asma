/**
 * "No answer", as the database reads it (spec 0007 AC-7, `pricing_answer_blank`): null, an empty list, or a
 * string of only whitespace and invisible marks. The browser uses it for the required hints (AC-21); the
 * database is the check. The class is the same as the SQL pattern in `catalog_trim` and `catalog_text_ok`
 * (migration `20261116090000_post_request`); `tests/requests-helpers.test.ts` proves the two copies agree.
 */

export const BLANK_CLASS =
  '\\s\\u00A0\\u00AD\\u034F\\u061C\\u115F\\u1160\\u1680\\u180E\\u2000-\\u200F\\u2028-\\u202F\\u205F-\\u2064' +
  '\\u2066-\\u2069\\u2800\\u3000\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}';

const EDGES = new RegExp(`^[${BLANK_CLASS}]+|[${BLANK_CLASS}]+$`, 'gu');

/** Trim whitespace and invisible marks from both ends, as `catalog_trim` does. */
export function trimBlank(text: string): string {
  return text.replace(EDGES, '');
}

export function isBlankAnswer(answer: unknown): boolean {
  if (answer === undefined || answer === null) return true;
  if (Array.isArray(answer)) return answer.length === 0;
  return typeof answer === 'string' && trimBlank(answer) === '';
}
